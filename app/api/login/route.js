import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, checkPassword, tokenFor } from "../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request) {
  let pw = "";
  try {
    const body = await request.json();
    pw = String(body.password || "");
  } catch {
    pw = "";
  }
  if (!checkPassword(pw)) {
    return NextResponse.json({ ok: false, error: "Mot de passe incorrect" }, { status: 401 });
  }
  cookies().set(COOKIE, tokenFor(pw), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 h
  });
  return NextResponse.json({ ok: true });
}
