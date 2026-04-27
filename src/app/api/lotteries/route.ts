import { NextResponse } from "next/server";
import { LOTTERIES } from "@/data/lotteries";

export async function GET() {
  return NextResponse.json({ lotteries: LOTTERIES });
}
