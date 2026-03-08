import { NextResponse } from "next/server";
import os from "os";

export async function GET() {
  const interfaces = os.networkInterfaces();
  let localIp = "";

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        localIp = addr.address;
        break;
      }
    }
    if (localIp) break;
  }

  return NextResponse.json({ ip: localIp });
}
