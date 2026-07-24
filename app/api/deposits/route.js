// Liste des acomptes de 50 € payés EN LIGNE (ECOM) — lue EN DIRECT sur SumUp.
// Sert au « vérificateur par 4 chiffres » du dashboard : le client cite sa carte, on confirme
// s'il a payé un acompte, sans ouvrir SumUp. Couvre TOUT l'historique (même avant le 16/07,
// même les séances passées, et même un futur paiement fait via un ancien lien encore en cache).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, isAuthed } from "../../../lib/auth";
import { listTransactions, getTransactionDetail } from "../../../lib/sumup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAuthed(cookies().get(COOKIE)?.value)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const tx = await listTransactions(150);
  if (!tx.ok) return NextResponse.json({ ok: false, error: tx.error });

  const up = (v) => String(v || "").toUpperCase();
  const amt = (a) => {
    const n = typeof a === "number" ? a : parseFloat(String(a || "0").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const items = tx.items.filter(
    (t) =>
      Math.round(amt(t.amount)) === 50 &&
      up(t.payment_type || t.type) === "ECOM" &&
      up(t.status) === "SUCCESSFUL"
  );

  const deposits = [];
  await Promise.all(
    items.map(async (t) => {
      const d = await getTransactionDetail(t.id || t.transaction_code);
      const c = d && d.card;
      const card = (c && (c.last_4_digits || c.last4)) || "";
      if (card) deposits.push({ card, date: t.timestamp || t.date, code: t.transaction_code || t.id });
    })
  );
  deposits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return NextResponse.json({ ok: true, deposits });
}
