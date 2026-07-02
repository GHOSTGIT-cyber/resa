// Retour d'autorisation SumUp : SumUp renvoie ici (?code=&state=) après que Nico
// a cliqué « Autoriser ». On vérifie le state, on échange le code contre un jeton.
import { verifyState, exchangeCode } from "../../../../lib/sumup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title, msg, ok) {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>SumUp</title></head>` +
      `<body style="margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;">` +
      `<div style="max-width:480px;margin:60px auto;padding:28px;background:#fff;border-radius:14px;text-align:center;">` +
      `<h1 style="color:${ok ? "#1a7f4b" : "#b23b3b"};font-size:22px;margin:0 0 10px;">${title}</h1>` +
      `<p style="font-size:15px;line-height:1.6;color:#0F2830;">${msg}</p></div></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (err) return page("Autorisation refusée", `SumUp a renvoyé : ${err}`, false);
  if (!verifyState(state)) return page("Lien expiré", "Relance la connexion depuis /api/sumup/connect.", false);
  if (!code) return page("Erreur", "Code d'autorisation manquant.", false);

  const res = await exchangeCode(code);
  if (res.ok) {
    return page(
      "SumUp connecté ✅",
      "Le compte est lié. Les acomptes seront désormais encaissés et marqués « Payé » automatiquement.",
      true
    );
  }
  return page("Échec de connexion", `Impossible d'obtenir le jeton : ${res.error || "erreur"}.`, false);
}
