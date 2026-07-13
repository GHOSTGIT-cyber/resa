// Webhook SumUp : appelé quand un paiement change d'état. On extrait un id de
// checkout du corps (formats variables → on tente plusieurs champs), on retrouve
// la réservation liée, et on RE-VÉRIFIE le statut via l'API (source de vérité)
// avant de marquer « Payé ». Ne renvoie jamais d'erreur (SumUp réessaierait).
import { NextResponse } from "next/server";
import { refByCheckoutId, checkPaymentStatus } from "../../../../lib/sumup";
import { markPaid } from "../../../../lib/paid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const ref = refByCheckoutId(id);
    if (ref) {
      const { paid } = await checkPaymentStatus(ref).catch(() => ({ paid: false }));
      // markPaid est idempotent : pas de double mail si le retour navigateur est déjà passé.
      if (paid) await markPaid(ref, true).catch(() => {});
    }
  } catch {
    /* on avale : best-effort */
  }
  return NextResponse.json({ ok: true });
}
