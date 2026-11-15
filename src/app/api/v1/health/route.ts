import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    contract_version: "ejb.backend/1",
    service: "earth-jukebox reference backend",
    time: new Date().toISOString()
  });
}