export interface WarehouseEvent {
  id: string;
  timestamp: number;
  action: string;
  status: "success" | "failure";
  location?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH";
  failureType?: string;
  correction?: string;
  costImpact?: number;
  triggerSignal?: string;
  confidence?: number;
  robotId?: string;
  missed?: boolean;
  latencyMs?: number;
}

const ROBOT_IDS = ["WH-BOT-01", "WH-BOT-02", "WH-BOT-03", "WH-BOT-04", "WH-BOT-05", "WH-BOT-06"];

const TASK_TEMPLATES: { action: string; location: string }[] = [
  { action: "Picking item from shelf B3", location: "Shelf B3" },
  { action: "Placing item in bin #14", location: "Bin Area" },
  { action: "Navigating to station 4", location: "Transit" },
  { action: "Scanning barcode on pallet P-2284", location: "Scan Zone" },
  { action: "Loading conveyor belt C2", location: "Conveyor C2" },
  { action: "Retrieving item from shelf A7", location: "Shelf A7" },
  { action: "Sorting package to lane 3", location: "Sort Lane 3" },
  { action: "Stacking boxes in zone D", location: "Zone D" },
  { action: "Verifying item weight — 4.2 kg", location: "Weigh Station" },
  { action: "Transferring pallet to dock 2", location: "Dock 2" },
  { action: "Restocking shelf F6 with SKU #4421", location: "Shelf F6" },
  { action: "Depositing item in returns bin", location: "Returns" },
  { action: "Picking item from shelf C5", location: "Shelf C5" },
  { action: "Delivering package to conveyor A1", location: "Conveyor A1" },
  { action: "Re-scanning misread barcode on item #8823", location: "Scan Zone" },
];

const FAILURE_EVENTS: {
  failureType: string;
  action: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  correction: string;
  costImpact: number;
  triggerSignal: string;
}[] = [
  {
    failureType: "Item Drop",
    action: "Item dropped mid-transit — grip failure detected",
    severity: "HIGH",
    correction: "Increase grip force to 75% on next attempt. Re-approach pickup point and verify secure hold before movement.",
    costImpact: 240,
    triggerSignal: "Grip force sensor: 12N below threshold",
  },
  {
    failureType: "Wrong SKU",
    action: "Picked wrong SKU — barcode mismatch detected",
    severity: "MEDIUM",
    correction: "Re-scan barcode. Verify SKU matches manifest before lifting. Cross-reference with bin label.",
    costImpact: 180,
    triggerSignal: "Barcode scanner: SKU mismatch (expected #4421, got #4412)",
  },
  {
    failureType: "Placement Miss",
    action: "Bin placement missed by 3.2cm — item misaligned",
    severity: "LOW",
    correction: "Recalibrate placement arm +3.2cm offset on Y-axis. Re-attempt drop sequence.",
    costImpact: 45,
    triggerSignal: "Position encoder: 3.2cm Y-axis offset detected",
  },
  {
    failureType: "Obstruction",
    action: "Conveyor belt obstruction detected — emergency stop triggered",
    severity: "HIGH",
    correction: "Halt all movement on conveyor C2. Alert supervisor. Clear obstruction before resuming operations.",
    costImpact: 500,
    triggerSignal: "LiDAR scan: foreign object at 0.12m on conveyor path",
  },
  {
    failureType: "Unsecured Load",
    action: "Item not secured before movement initiated",
    severity: "HIGH",
    correction: "Verify grip force ≥ 60% on all axes before transit. Re-grasp and confirm sensor reading.",
    costImpact: 380,
    triggerSignal: "Load cell: grip confirmation < 60% threshold",
  },
  {
    failureType: "Collision Risk",
    action: "Proximity sensor triggered — potential collision at 0.4m",
    severity: "HIGH",
    correction: "Halt all joint movement immediately. Re-evaluate navigation path. Increase minimum safe clearance to 0.8m.",
    costImpact: 750,
    triggerSignal: "Proximity sensor array: 0.4m clearance breach",
  },
  {
    failureType: "Payload Overload",
    action: "Item weight exceeds rated payload by 14%",
    severity: "MEDIUM",
    correction: "Switch to two-arm grip sequence. Reduce travel speed to 40% for this payload class.",
    costImpact: 210,
    triggerSignal: "Force/torque sensor: 14% over rated payload limit",
  },
  {
    failureType: "Angle Deviation",
    action: "Shelf retrieval angle deviation > 5° from baseline",
    severity: "LOW",
    correction: "Re-home arm to calibration position. Re-approach shelf at standard 0° offset and retry.",
    costImpact: 60,
    triggerSignal: "IMU: 5.3° tilt deviation from baseline",
  },
  {
    failureType: "Sensor Fault",
    action: "Depth sensor reading inconsistent — frame skipped",
    severity: "MEDIUM",
    correction: "Run sensor self-calibration sequence. If fault persists, flag unit for hardware inspection.",
    costImpact: 290,
    triggerSignal: "Depth camera: frame correlation failure (3 consecutive frames)",
  },
  {
    failureType: "Path Blocked",
    action: "Navigation path blocked — obstacle detected at waypoint 3",
    severity: "HIGH",
    correction: "Reroute via alternate path C. If unavailable, hold position and request manual clearance.",
    costImpact: 420,
    triggerSignal: "Nav mesh: waypoint 3 unreachable — obstacle detected",
  },
];

// ~28% failure rate
const FAILURE_RATE = 0.28;
// ~4% of failures are missed (false negatives)
const MISS_RATE = 0.04;

function randFloat(min: number, max: number, decimals = 1) {
  const val = min + Math.random() * (max - min);
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export function generateNextEvent(): WarehouseEvent {
  const id = Math.random().toString(36).slice(2, 10);
  const robotId = ROBOT_IDS[Math.floor(Math.random() * ROBOT_IDS.length)];
  const isFailure = Math.random() < FAILURE_RATE;

  if (isFailure) {
    const f = FAILURE_EVENTS[Math.floor(Math.random() * FAILURE_EVENTS.length)];
    const missed = Math.random() < MISS_RATE;
    const confidence = randFloat(82, 97);
    return {
      id,
      timestamp: Date.now(),
      action: f.action,
      status: "failure",
      severity: f.severity,
      failureType: f.failureType,
      correction: f.correction,
      costImpact: f.costImpact,
      triggerSignal: f.triggerSignal,
      confidence,
      robotId,
      missed,
    };
  }

  const t = TASK_TEMPLATES[Math.floor(Math.random() * TASK_TEMPLATES.length)];
  return {
    id,
    timestamp: Date.now(),
    action: t.action,
    location: t.location,
    status: "success",
    confidence: randFloat(93, 99),
    robotId,
  };
}
