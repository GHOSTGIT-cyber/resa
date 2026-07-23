// Page RÉCONCILIATION (protégée par le mot de passe du dashboard).
// Elle tourne DANS le conteneur -> elle a accès au jeton SumUp de Nico (fichier volume),
// le seul qui peut lire les VRAIES transactions encaissées. Objectif : ne JAMAIS rater un
// paiement. Elle affiche :
//   1) l'état du jeton (fonctionne-t-il ? sinon rien ne remonte automatiquement) ;
//   2) la liste RÉELLE des paiements SumUp (source de vérité) ;
//   3) les réservations confirmées NON payées (à rapprocher à l'œil des paiements ci-dessus).
import { cookies } from "next/headers";
import { COOKIE, isAuthed } from "../../lib/auth";
import { readAll } from "../../lib/store";
import { enabledSiteIds, defaultSiteId } from "../../lib/sites";
import { tokenHealth, listTransactions } from "../../lib/sumup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function html(body, status = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Réconciliation paiements</title>` +
      `<style>` +
      `body{margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;color:#0F2830;}` +
      `.wrap{max-width:1000px;margin:24px auto;padding:0 16px;}` +
      `h1{font-size:22px;color:#F4631F;}h2{font-size:17px;margin:26px 0 8px;}` +
      `.card{background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 4px 16px rgba(15,40,48,.07);}` +
      `.ok{background:#e6f7ec;color:#1a7f4b;}.ko{background:#fdecea;color:#c0392b;}` +
      `.banner{border-radius:10px;padding:14px 16px;font-weight:bold;margin-bottom:14px;}` +
      `table{width:100%;border-collapse:collapse;font-size:13px;}` +
      `th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;}` +
      `th{background:#f7fafa;color:#5B6B6E;font-size:12px;}` +
      `.badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:bold;}` +
      `.b-ok{background:#e6f7ec;color:#1a7f4b;}.b-ko{background:#fdecea;color:#c0392b;}.b-w{background:#fff4e5;color:#b26a00;}` +
      `.muted{color:#5B6B6E;font-size:12px;}a.back{color:#F4631F;text-decoration:none;font-weight:bold;}` +
      `</style></head><body><div class="wrap">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// "2026-07-23T08:17:03Z" -> "23/07 08:17" (heure de Paris)
function fmt(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}
function money(a, c) {
  const n = typeof a === "number" ? a : parseFloat(String(a || "0").replace(",", "."));
  return (Number.isFinite(n) ? n.toFixed(2) : a) + " " + (c || "");
}

export async function GET() {
  if (!isAuthed(cookies().get(COOKIE)?.value)) {
    return html(
      `<h1>Réconciliation paiements</h1><div class="card">Connecte-toi d'abord au ` +
        `<a class="back" href="/">dashboard</a>, puis reviens sur cette page.</div>`,
      401
    );
  }

  const health = await tokenHealth();
  const tx = await listTransactions(50);
  const enabled = enabledSiteIds();
  const resas = readAll().filter((r) => enabled.includes(r.siteId || defaultSiteId()));
  const confirmedUnpaid = resas
    .filter((r) => r.status === "confirmed" && !r.paid)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const paid = resas.filter((r) => r.paid);

  // --- Bandeau verdict : le jeton marche-t-il ? ---
  let banner;
  if (health.works) {
    banner =
      `<div class="banner ok">✅ SumUp opérationnel — marchand ${esc(health.merchant || "?")}. ` +
      `Les paiements passant par un lien UNIQUE remontent automatiquement.</div>`;
  } else if (health.connected) {
    banner =
      `<div class="banner ko">⛔ SumUp connecté MAIS le jeton ne répond pas (expiré/révoqué). ` +
      `Aucun paiement ne remonte tout seul — il faut RECONNECTER via /api/sumup/connect.</div>`;
  } else {
    banner =
      `<div class="banner ko">⛔ SumUp NON connecté. Aucune détection automatique. ` +
      `Autorise l'app via /api/sumup/connect.</div>`;
  }

  // --- Tableau des VRAIS paiements SumUp ---
  let txHtml;
  if (!tx.ok) {
    txHtml = `<div class="card ko">Impossible de lire les transactions SumUp : ${esc(tx.error)}</div>`;
  } else if (!tx.items.length) {
    txHtml = `<div class="card">Aucune transaction retournée par SumUp.</div>`;
  } else {
    const rows = tx.items
      .map((t) => {
        const st = String(t.status || "").toUpperCase();
        const cls = st === "SUCCESSFUL" ? "b-ok" : st === "FAILED" || st === "CANCELLED" ? "b-ko" : "b-w";
        return (
          `<tr><td>${esc(fmt(t.timestamp || t.date))}</td>` +
          `<td><b>${esc(money(t.amount, t.currency))}</b></td>` +
          `<td><span class="badge ${cls}">${esc(st || "?")}</span></td>` +
          `<td>${esc(t.payment_type || t.type || "—")}</td>` +
          `<td class="muted">${esc(t.transaction_code || t.id || "—")}</td></tr>`
        );
      })
      .join("");
    txHtml =
      `<div class="card"><table><tr><th>Quand (Paris)</th><th>Montant</th><th>Statut</th>` +
      `<th>Type</th><th>Code SumUp</th></tr>${rows}</table>` +
      `<p class="muted">Source de vérité = compte SumUp. Chaque paiement SUCCESSFUL doit correspondre ` +
      `à une réservation « Payé » ci-dessous. S'il en manque une, c'est un paiement à pointer à la main.</p></div>`;
  }

  // --- Réservations confirmées NON payées (candidates) ---
  const cuRows = confirmedUnpaid
    .map(
      (r) =>
        `<tr><td>${esc(r.ref)}</td><td>${esc(r.name || "—")}</td>` +
        `<td>${esc(r.date)} ${esc(r.slot)}</td><td class="muted">créée ${esc(fmt(r.createdAt))}</td></tr>`
    )
    .join("");
  const cuHtml = confirmedUnpaid.length
    ? `<div class="card"><table><tr><th>Réf</th><th>Client</th><th>Séance</th><th></th></tr>${cuRows}</table></div>`
    : `<div class="card ok">Aucune réservation confirmée en attente de paiement. 👌</div>`;

  const body =
    `<h1>Réconciliation des paiements</h1>` +
    banner +
    `<h2>1. Paiements réellement encaissés sur SumUp (${tx.ok ? tx.items.length : 0})</h2>` +
    txHtml +
    `<h2>2. Réservations confirmées NON marquées « Payé » (${confirmedUnpaid.length})</h2>` +
    cuHtml +
    `<p class="muted" style="margin-top:10px;">Réservations déjà marquées « Payé » : ${paid.length}. ` +
    `<a class="back" href="/">← retour au dashboard</a></p>`;

  return html(body);
}
