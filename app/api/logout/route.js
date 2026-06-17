import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE } from "../../../lib/auth";

export const runtime = "nodejs";

export async function POST() {
  cookies().delete(COOKIE);
  return NextResponse.json({ ok: true });
}
