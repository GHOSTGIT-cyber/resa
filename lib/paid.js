// Point d'entrée UNIQUE du passage « payé » — quelle que soit la source :
//   - bouton 💶 du dashboard (employé qui voit l'acompte dans SumUp),
//   - retour client / webhook SumUp (auto, dormant tant que le scope `payments` n'est pas validé).
// Tout passe ici pour qu'on ne puisse PAS encaisser sans prévenir le client :
//   1. on écrit paid/paidAt,  2. payer = confirmer,  3. mail « paiement reçu » au client,
//   4. l'agenda affiche « 💶 PAYÉ ».
// Le mail part au PREMIER passage en payé (ou sur renvoi explicite) — jamais en double.
import { readAll, update, setStatus } from "./store";
import { sendPaymentReceipt } from "./notify";
import { upsertReservationEvent } from "./google-calendar";

export async function markPaid(ref, paid, opts = {}) {
  const before = readAll().find((x) => x.ref === ref);
  if (!before) return { ok: false, error: "réservation introuvable" };
  const wasPaid = !!before.paid;

  const ok = update(ref, {
    paid: !!paid,
    paidAt: paid ? before.paidAt || new Date().toISOString() : "",
  });
  if (!ok) return { ok: false, error: "mise à jour échouée" };

  // Payer = confirmer. On ne ressuscite PAS une résa annulée (cas remboursement).
  if (paid && before.status !== "confirmed" && before.status !== "cancelled") {
    setStatus(ref, "confirmed");
  }

  const r = readAll().find((x) => x.ref === ref);
  const cancelled = r.status === "cancelled";

  // Mail au client : au 1er passage en payé, ou renvoi demandé depuis le dashboard.
  // JAMAIS sur une résa annulée : le reçu annonce « réservation confirmée » — on ne peut pas
  // écrire ça à quelqu'un dont la session est annulée. On garde juste la trace du paiement
  // (encaissement à rembourser), et on le signale à l'employé.
  let emailed = null;
  if (paid && !cancelled && (!wasPaid || opts.resend)) emailed = await sendPaymentReceipt(r);

  // Agenda (best-effort, jamais bloquant) : le titre porte « 💶 PAYÉ ».
  if (!cancelled) await upsertReservationEvent(r).catch(() => {});

  return { ok: true, emailed, alreadyPaid: wasPaid, cancelled };
}
