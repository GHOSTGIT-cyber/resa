// Point d'entrée OAuth : c'est CE lien que tu envoies à Nico.
// Il le redirige vers la page d'autorisation SumUp ; après son « Autoriser »,
// SumUp le renvoie vers /api/sumup/callback.
import { NextResponse } from "next/server";
import { sumupOAuthConfigured, makeState, authorizeUrl } from "../../../../lib/sumup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!sumupOAuthConfigured()) {
    return new NextResponse(
      "SumUp non configuré (SUMUP_CLIENT_ID / SUMUP_CLIENT_SECRET manquants dans Coolify).",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
  return NextResponse.redirect(authorizeUrl(makeState()));
}
