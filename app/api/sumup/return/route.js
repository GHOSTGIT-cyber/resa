// Retour du client après paiement sur la page SumUp. On vérifie le statut du
// checkout (source de vérité = l'API SumUp) et on passe la résa en « Payé ».
import { checkAndMarkPaid } from "../../../../lib/sumup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title, msg, ok) {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Paiement</title></head>` +
      `<body style="margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;">` +
      `<div style="max-width:480px;margin:60px auto;padding:28px;background:#fff;border-radius:14px;text-align:center;">` +
      `<h1 style="color:${ok ? "#1a7f4b" : "#F4631F"};font-size:22px;margin:0 0 10px;">${title}</h1>` +
      `<p style="font-size:15px;line-height:1.6;color:#0F2830;">${msg}</p></div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request) {
  const ref = new URL(request.url).searchParams.get("ref") || "";
  const res = await checkAndMarkPaid(ref);
  if (res.paid) return page("Paiement reçu ✅", "Merci ! Votre acompte est bien enregistré. À très vite sur l'eau 🌊", true);
  return page(
    "Paiement en cours",
    "Si tu viens de payer, le statut peut mettre quelques instants. Sinon, tu peux réessayer depuis l'e-mail.",
    false
  );
}
