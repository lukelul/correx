import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export interface CheckResult {
  label: string;
  status: "pass" | "fail" | "warning";
  detail: string;
}

export interface MotorCommands {
  translation: { x: number; y: number; z: number }; // cm deltas — x=right, y=forward, z=up
  wrist_rotate: number;        // degrees, positive = clockwise
  wrist_pitch: number;         // degrees, positive = tilt down
  gripper_width_mm: number | null; // absolute target opening in mm (20–100), null = no change
  approach_angle_deg: number | null; // approach angle from vertical in degrees, null = no change
}

export interface VerificationResult {
  verdict: "PASS" | "FAIL";
  confidence: number;
  summary: string;
  checks: CheckResult[];
  risk_level: "low" | "medium" | "high" | "critical";
  recommendation: string;
  failure_reasoning: string | null;
  corrective_action: string | null;
  motor_commands: MotorCommands | null;
}

// Token cost estimates per image (OpenAI pricing):
//   high detail: ~1000 tokens per 512×512 tile (640px wide → ~2 tiles → ~1700 tokens)
//   low detail:  85 tokens flat regardless of size
const TOKENS_HIGH = 1700;
const TPM_BUDGET = 25000; // stay safely under 30k TPM limit
const MAX_FRAMES = 20;    // hard cap regardless of token budget

const SYSTEM_PROMPT = `You are a robotic task verification AI. Your job is to analyze images or video frames from robotic task executions and determine whether the task was completed correctly and safely.

CRITICAL INSPECTION RULES:
- Scan the ENTIRE frame including all four corners and edges — objects are often placed near the periphery of the scene.
- Do not assume an item is absent just because it is small, partially occluded, or at the edge of the frame. Look carefully.
- When counting items (e.g. "plate 2 sausages, 2 hashbrowns, 1 egg"), verify each item individually and note its position.
- NEVER assume the meaning of a dial, knob, switch, or indicator light based on generic conventions. Different appliances have different markings. If the user has provided context about how a specific appliance works, that context is ground truth — trust it over your own assumptions.
- If you are uncertain about the state of something (e.g. a knob position), say so explicitly and mark it "warning", not "fail". Only mark "fail" when you have clear visual evidence.
- If a reference image is provided showing the correct/safe state, compare the current image directly to it and describe any differences.

You must evaluate:
1. Task completion accuracy — did the robot actually accomplish what was asked? Count every required item.
2. Safety compliance — are there any hazards left behind (e.g., stove left on, spills, unstable objects)?
3. Environmental state — is the environment in an acceptable post-task state?
4. Unintended consequences — did the robot cause any collateral issues?

When multiple frames are provided, they are evenly-spaced samples from a video recording of the task. Use the temporal sequence to understand what happened throughout the task, not just the final state. The last frame is most important for verifying final placement.

OBJECT TRACKING RULE:
If the task involves the robot manipulating or transporting an object, that object must remain visible in frame throughout the entire sequence — unless it has been intentionally placed at the target destination. If the object disappears from frame before placement is confirmed, flag this as a warning or fail under "Unintended Consequences" and note the frame at which the object was last seen.

REASONING REQUIREMENTS (for FAIL verdicts only):

Level 1 — Failure Explanation: Reason through the root cause chain of the failure with specificity. Identify the precise mechanism: approach angle, gripper alignment, timing, force applied, object position offset, visual occlusion, etc. Reference specific observable evidence from the frames (e.g., "the gripper shadow indicates a 15° off-axis approach", "the item is 3cm left of the target zone visible in frame 4"). Be quantitative where possible.

Level 2 — Corrective Action: Given the diagnosed failure mechanism, specify the exact corrective motion sequence the robot should execute on the next attempt. Include concrete parameters: direction, distance, angle adjustments, joint rotations, timing changes, grip width, approach vector. Write this as an actionable instruction the robot's controller could act on.
For placement failures specifically, be highly spatial: describe the target zone relative to visible landmarks, state the required translation in all three axes (e.g. "move 4cm left along X, 2cm forward along Y, lower 1.5cm on Z"), the required orientation, and the exact point at which to release. Estimate distances from visible object scales and scene geometry — make the numbers realistic and grounded in what is observable.

Return a JSON object with this exact structure:
{
  "verdict": "PASS" or "FAIL",
  "confidence": number between 0 and 100,
  "summary": "one or two sentence plain-English summary of what you observed, including positions of key items",
  "checks": [
    { "label": "Task Completion", "status": "pass"|"fail"|"warning", "detail": "List each required item and whether you can see it, including its position in the frame" },
    { "label": "Safety Compliance", "status": "pass"|"fail"|"warning", "detail": "Describe exactly what you see and why you reached your conclusion. Do not assume appliance state — cite the specific visual evidence." },
    { "label": "Environmental State", "status": "pass"|"fail"|"warning", "detail": "..." },
    { "label": "Unintended Consequences", "status": "pass"|"fail"|"warning", "detail": "..." }
  ],
  "risk_level": "low"|"medium"|"high"|"critical",
  "recommendation": "brief actionable recommendation",
  "failure_reasoning": "Level 1 chain-of-thought root cause explanation with specific visual evidence and quantitative detail. Set to null for PASS.",
  "corrective_action": "Level 2 exact corrective motion sequence with concrete parameters (angles, distances, directions, joint adjustments). Set to null for PASS.",
  "motor_commands": {
    "translation": { "x": 0.0, "y": 0.0, "z": 0.0 },
    "wrist_rotate": 0.0,
    "wrist_pitch": 0.0,
    "gripper_width_mm": null,
    "approach_angle_deg": null
  }
}

motor_commands must be grounded in the corrective_action values — extract and convert the correction into exact numeric motor targets. x=right(+)/left(-), y=forward(+)/back(-), z=up(+)/down(-) in cm. wrist_rotate positive=clockwise. wrist_pitch positive=tilt down. gripper_width_mm is the absolute target opening (e.g. 45 for a narrow grip, 80 for open). approach_angle_deg is degrees from vertical (0=straight down). All values must be realistic — derive them from visible scene geometry. Set motor_commands to null for PASS.

Be precise — do not conflate uncertainty with danger. Mark things "warning" when you cannot be sure, and only use "fail" + high/critical risk when there is clear visual evidence of a problem. Return ONLY valid JSON, no markdown.`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const taskDescription = formData.get("task") as string;

    if (!taskDescription) {
      return NextResponse.json(
        { error: "Task description is required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured. Add OPENAI_API_KEY to your .env.local file." },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

    const context = (formData.get("context") as string | null)?.trim() || null;

    // Optional reference image (known-correct state)
    const refFile = formData.get("referenceImage") as File | null;
    let referenceImageUrl: string | null = null;
    if (refFile && refFile.size > 0) {
      const refBytes = await refFile.arrayBuffer();
      const refBase64 = Buffer.from(refBytes).toString("base64");
      const refMime = refFile.type || "image/jpeg";
      referenceImageUrl = `data:${refMime};base64,${refBase64}`;
    }

    type ImageContent = {
      type: "image_url";
      image_url: { url: string; detail: "high" | "low" | "auto" };
    };

    const rawFrameCount = parseInt(formData.get("frameCount") as string ?? "0", 10);
    let allFrameData: { url: string; ts: number }[] = [];

    if (rawFrameCount > 0) {
      for (let i = 0; i < rawFrameCount; i++) {
        const frameData = formData.get(`frame_${i}`) as string;
        const ts = parseFloat(formData.get(`frame_${i}_ts`) as string ?? "0");
        if (frameData) allFrameData.push({ url: frameData, ts });
      }
    } else {
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No image file or frames provided." }, { status: 400 });
      }
      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const mimeType = file.type || "image/jpeg";
      allFrameData.push({ url: `data:${mimeType};base64,${base64}`, ts: 0 });
    }

    if (allFrameData.length === 0) {
      return NextResponse.json({ error: "No valid images to analyze." }, { status: 400 });
    }

    // --- Token budget management ---
    // 1. Hard cap at MAX_FRAMES, evenly subsampled to preserve temporal spread
    if (allFrameData.length > MAX_FRAMES) {
      const step = allFrameData.length / MAX_FRAMES;
      allFrameData = Array.from({ length: MAX_FRAMES }, (_, i) =>
        allFrameData[Math.min(Math.round(i * step), allFrameData.length - 1)]
      );
    }

    // 2. Choose detail level based on token budget
    //    high detail: ~1700 tokens/frame, low detail: 85 tokens/frame
    const frameCount = allFrameData.length;
    const tokensIfHigh = frameCount * TOKENS_HIGH;
    const detail: "high" | "low" = tokensIfHigh <= TPM_BUDGET ? "high" : "low";

    const imageContents: ImageContent[] = allFrameData.map((f) => ({
      type: "image_url",
      image_url: { url: f.url, detail },
    }));

    const isVideo = rawFrameCount > 1;
    const frameLabel = isVideo
      ? `${frameCount} frames extracted from the video (detail: ${detail})`
      : "this image";

    // Build the user message content
    type TextContent = { type: "text"; text: string };
    const userContent: (TextContent | ImageContent)[] = [];

    // Main prompt text
    let promptText = `The robot was asked to: "${taskDescription}"\n`;
    if (context) {
      promptText += `\nIMPORTANT CONTEXT about this specific environment/appliance (treat this as ground truth):\n${context}\n`;
    }
    if (referenceImageUrl) {
      promptText += `\nA reference image showing the CORRECT/SAFE state is provided first, followed by the image(s) to verify. Compare them directly.\n`;
    }
    promptText += `\nAnalyze ${frameLabel} and determine if the task was completed correctly and safely.`;
    if (isVideo) promptText += " The frames are in chronological order from start to end of the recording.";

    userContent.push({ type: "text", text: promptText });

    // Reference image goes first if provided
    if (referenceImageUrl) {
      userContent.push({
        type: "image_url",
        image_url: { url: referenceImageUrl, detail: "high" },
      });
      userContent.push({ type: "text", text: "--- End of reference image. Now analyzing the task output below: ---" });
    }

    // Task output frames
    userContent.push(...imageContents);

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    });

    const raw = (response.choices[0]?.message?.content ?? "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    let result: VerificationResult;
    try {
      result = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse model response. Raw: " + raw },
        { status: 500 }
      );
    }

    // Return detail mode used so the UI can show it
    return NextResponse.json({ ...result, _detail: detail, _framesSent: frameCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
