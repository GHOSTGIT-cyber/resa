// Page de paiement : le client clique le bouton du mail -> arrive ici -> on crée
// un Hosted Checkout SumUp à la volée (valable 30 min) et on le redirige vers la
// page de paiement SumUp. La carte est tapée CHEZ SumUp, jamais sur resa.
// Repli : si l'API SumUp n'est pas connectée, on redirige vers le lien fixe
// SUMUP_PAYMENT_LINK (si défini).
import { NextResponse } from "next/server";
import { readAll } from "../../lib/store";
import { verifyActionToken } from "../../lib/links";
import { sumupReady, createHostedCheckout } from "../../lib/sumup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errPage(msg) {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Paiement</title></head>` +
      `<body style="margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;">` +
      `<div style="max-width:480px;margin:60px auto;padding:28px;background:#fff;border-radius:14px;text-align:center;">` +
      `<h1 style="color:#F4631F;font-size:22px;margin:0 0 10px;">Paiement indisponible</h1>` +
      `<p style="font-size:15px;line-height:1.6;color:#0F2830;">${msg}</p></div></body></html>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref") || "";
  const t = url.searchParams.get("t") || "";
  if (!verifyActionToken(ref, "pay", t)) return errPage("Lien de paiement invalide ou expiré.");
  const r = readAll().find((x) => x.ref === ref);
  if (!r) return errPage("Réservation introuvable.");

  if (sumupReady()) {
    const res = await createHostedCheckout(r);
    if (res.ok && res.url) return NextResponse.redirect(res.url);
    // sinon on tombe sur le repli ci-dessous
  }
  const fallback = process.env.SUMUP_PAYMENT_LINK;
  if (fallback) return NextResponse.redirect(fallback);
  return errPage("Le paiement en ligne n'est pas encore activé. Contactez-nous, on s'occupe de tout.");
}
