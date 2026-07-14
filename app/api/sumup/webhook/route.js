// Webhook SumUp (`return_url` du checkout) : callback SERVEUR À SERVEUR appelé quand un
// paiement change d'état. C'est le SEUL filet quand le client paie puis ferme son onglet
// (pas de retour navigateur) — sans lui, le paiement passerait inaperçu.
//
// On ne connaît pas avec certitude la forme du corps envoyé par SumUp : on tente donc
// plusieurs champs (id de checkout, puis checkout_reference), on RE-VÉRIFIE le statut via
// l'API (seule source de vérité — on ne fait jamais confiance au corps du webhook pour
// marquer « payé »), puis markPaid() fait le reste (statut, mail client, agenda).
// markPaid est idempotent : aucun double mail si le retour navigateur est déjà passé.
// On répond toujours 200 : une erreur ferait réessayer SumUp en boucle.
import { NextResponse } from "next/server";
import { refByCheckoutId, checkPaymentStatus } from "../../../../lib/sumup";
import { markPaid } from "../../../../lib/paid";
import { readAll } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// checkout_reference = `<ref>-<suffixe>` (cf. createHostedCheckout). On retire le dernier
// segment pour retrouver la ref, qui peut elle-même contenir des tirets (EFCA-1752...).
function refFromCheckoutReference(cr) {
  const s = String(cr || "");
  if (!s) return "";
  const candidate = s.replace(/-[^-]*$/, "");
  return readAll().some((x) => x.ref === candidate) ? candidate : "";
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id =
      body.id ||
      body.checkout_id ||
      body.resource_id ||
      body?.data?.id ||
      body?.payload?.id ||
      "";
    const checkoutRef =
      body.checkout_reference || body?.data?.checkout_reference || body?.payload?.checkout_reference || "";

    // 1) par l'id de checkout qu'on a stocké ; 2) à défaut, par la référence.
    const ref = refByCheckoutId(id) || refFromCheckoutReference(checkoutRef);

    if (!ref) {
      // Payload inattendu : on le trace pour pouvoir corriger l'extraction sans deviner.
      console.warn("[sumup] webhook : réservation introuvable —", JSON.stringify(body).slice(0, 300));
      return NextResponse.json({ ok: true });
    }

    const { paid } = await checkPaymentStatus(ref).catch(() => ({ paid: false }));
    console.log(`[sumup] webhook (${ref}) -> payé=${paid}`);
    if (paid) await markPaid(ref, true).catch(() => {});
  } catch (e) {
    console.error("[sumup] webhook erreur :", e?.message || e);
  }
  return NextResponse.json({ ok: true });
}
