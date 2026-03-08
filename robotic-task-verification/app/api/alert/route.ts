import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, phone, failureType, severity, confidence, costImpact, correction, robotId } = body;

  const results = { emailSent: false, smsSent: false, errors: [] as string[] };

  const alertSubject = `⚠️ Correx Alert [${severity}]: ${failureType}`;
  const alertText = [
    `CORREX SAFETY ALERT`,
    ``,
    `Severity: ${severity}`,
    `Failure: ${failureType}`,
    `Robot: ${robotId}`,
    `Confidence: ${confidence}%`,
    `Cost Impact: $${costImpact}`,
    ``,
    `Correction: ${correction}`,
    ``,
    `— Correx Safety Compliance Layer`,
  ].join("\n");

  const alertHtml = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:${severity === "HIGH" ? "#ef4444" : severity === "MEDIUM" ? "#f97316" : "#eab308"};padding:20px 24px;">
        <p style="margin:0;color:white;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Correx Safety Alert</p>
        <h1 style="margin:6px 0 0;color:white;font-size:22px;font-weight:800;">${failureType}</h1>
      </div>
      <div style="padding:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Severity</td><td style="font-weight:600;color:#111827;">${severity}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Robot</td><td style="font-weight:600;color:#111827;">${robotId}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Confidence</td><td style="font-weight:600;color:#111827;">${confidence}%</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Cost Impact</td><td style="font-weight:700;color:#dc2626;">$${costImpact}</td></tr>
        </table>
        <div style="margin-top:16px;background:#fef2f2;border-left:3px solid #ef4444;padding:12px 16px;border-radius:4px;">
          <p style="margin:0;font-size:12px;font-weight:600;color:#991b1b;margin-bottom:4px;">Correction Required</p>
          <p style="margin:0;font-size:13px;color:#7f1d1d;line-height:1.5;">${correction}</p>
        </div>
        <p style="margin:20px 0 0;font-size:11px;color:#9ca3af;">Sent by Correx · Robotic Safety Compliance Layer</p>
      </div>
    </div>
  `;

  // Email via Resend REST API
  if (email && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Correx Alerts <onboarding@resend.dev>",
          to: [email],
          subject: alertSubject,
          html: alertHtml,
          text: alertText,
        }),
      });
      if (res.ok) {
        results.emailSent = true;
      } else {
        const errBody = await res.json().catch(() => ({}));
        results.errors.push(`Email: ${errBody.message || res.statusText}`);
      }
    } catch (e) {
      results.errors.push(`Email: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // SMS via Twilio REST API
  if (
    phone &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  ) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_FROM_NUMBER;
      const smsBody = `CORREX [${severity}] ${failureType} — ${robotId}\nConfidence: ${confidence}% | Cost: $${costImpact}\n${correction.slice(0, 120)}`;

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + Buffer.from(`${sid}:${auth}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: from, To: phone, Body: smsBody }).toString(),
        }
      );
      if (res.ok) {
        results.smsSent = true;
      } else {
        const errBody = await res.json().catch(() => ({}));
        results.errors.push(`SMS: ${errBody.message || res.statusText}`);
      }
    } catch (e) {
      results.errors.push(`SMS: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json(results);
}
