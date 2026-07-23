// Page RÉCONCILIATION (protégée par le mot de passe du dashboard). Tourne DANS le conteneur
// -> accès au jeton SumUp de Nico (le seul qui lit les VRAIES transactions).
// Objectif : pister TOUS les acomptes de 50 € et ne jamais en rater un.
//   1) état du jeton ; 2) TOUS les paiements de 50 € (ECOM en ligne + POS terminal), avec
//   4 derniers chiffres de carte et origine (API « Acompte eFoil — EFCA-… » = traçable, ou
//   lien fixe = fantôme) ; 3) RAPPROCHEMENT PAR CARTE : si un acompte en ligne a la même
//   carte qu'un paiement terminal, c'est le même client (il a payé l'acompte en ligne + le
//   solde sur place) ; 4) réservations confirmées non payées (séance passée/à venir + tél) ;
//   5) les autres ventes (hors acomptes) reléguées dans un bloc repliable.
import { cookies } from "next/headers";
import { COOKIE, isAuthed } from "../../lib/auth";
import { readAll } from "../../lib/store";
import { enabledSiteIds, defaultSiteId } from "../../lib/sites";
import { tokenHealth, listTransactions, getTransactionDetail } from "../../lib/sumup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEPOSIT = 50; // montant de l'acompte (SUMUP_AMOUNT)

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function html(body, status = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Réconciliation acomptes</title>` +
      `<style>` +
      `body{margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;color:#0F2830;}` +
      `.wrap{max-width:1080px;margin:24px auto;padding:0 16px;}` +
      `h1{font-size:22px;color:#F4631F;}h2{font-size:17px;margin:26px 0 8px;}` +
      `.card{background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 4px 16px rgba(15,40,48,.07);overflow-x:auto;}` +
      `.ok{background:#e6f7ec;color:#1a7f4b;}.ko{background:#fdecea;color:#c0392b;}` +
      `.banner{border-radius:10px;padding:14px 16px;font-weight:bold;margin-bottom:14px;}` +
      `table{width:100%;border-collapse:collapse;font-size:13px;}` +
      `th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap;}` +
      `th{background:#f7fafa;color:#5B6B6E;font-size:12px;}` +
      `.badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:bold;}` +
      `.b-ok{background:#e6f7ec;color:#1a7f4b;}.b-ko{background:#fdecea;color:#c0392b;}.b-w{background:#fff4e5;color:#b26a00;}` +
      `.b-i{background:#e8f0fe;color:#1a56b0;}` +
      `.muted{color:#5B6B6E;font-size:12px;}a.back{color:#F4631F;text-decoration:none;font-weight:bold;}` +
      `.api{color:#1a7f4b;font-weight:bold;}.fixe{color:#c0392b;font-weight:bold;}` +
      `details{margin-top:10px;}summary{cursor:pointer;color:#5B6B6E;font-weight:bold;}` +
      `</style></head><body><div class="wrap">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

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
function amountNum(a) {
  const n = typeof a === "number" ? a : parseFloat(String(a || "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function money(a, c) {
  return amountNum(a).toFixed(2) + " " + (c || "EUR");
}
function up(v) {
  return String(v || "").toUpperCase();
}

export async function GET() {
  if (!isAuthed(cookies().get(COOKIE)?.value)) {
    return html(
      `<h1>Réconciliation acomptes</h1><div class="card">Connecte-toi d'abord au ` +
        `<a class="back" href="/">dashboard</a> (même domaine), puis reviens sur cette page.</div>`,
      401
    );
  }

  const health = await tokenHealth();
  const tx = await listTransactions(80);
  const enabled = enabledSiteIds();
  const resas = readAll().filter((r) => enabled.includes(r.siteId || defaultSiteId()));
  const paidRefs = new Set(resas.filter((r) => r.paid).map((r) => r.ref));
  // Rapprochement FIABLE auto : un acompte encaissé via notre API a marqué la résa "payé"
  // à l'instant du paiement -> paidAt ≈ heure de la transaction. On relie par le temps.
  const paidByTime = resas
    .filter((r) => r.paid && r.paidAt)
    .map((r) => ({ ref: r.ref, name: r.name || "", at: Date.parse(r.paidAt) }))
    .filter((p) => Number.isFinite(p.at));
  function matchedPaid(t) {
    const pt = Date.parse(t.timestamp || t.date);
    if (!Number.isFinite(pt)) return null;
    return paidByTime.find((p) => Math.abs(p.at - pt) < 12 * 60 * 1000) || null;
  }
  const confirmedUnpaid = resas
    .filter((r) => r.status !== "cancelled" && !r.paid)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // Détails pour TOUTES les transactions réussies -> carte (last-4) + libellé/réf.
  const details = {};
  if (tx.ok) {
    const succ = tx.items.filter((t) => up(t.status) === "SUCCESSFUL").slice(0, 80);
    await Promise.all(
      succ.map(async (t) => {
        const k = t.id || t.transaction_code;
        details[k] = await getTransactionDetail(k);
      })
    );
  }
  const keyOf = (t) => t.id || t.transaction_code;
  function card4(t) {
    const c = details[keyOf(t)] && details[keyOf(t)].card;
    return (c && (c.last_4_digits || c.last4)) || "";
  }
  function cardStr(t) {
    const c = details[keyOf(t)] && details[keyOf(t)].card;
    if (!c) return "";
    const l4 = c.last_4_digits || c.last4 || "";
    return (l4 ? "•••• " + l4 : "") + (c.type ? " " + c.type : "");
  }
  function refOf(t) {
    const d = details[keyOf(t)];
    if (!d) return "";
    const cands = [];
    if (d.checkout_reference) cands.push(d.checkout_reference);
    if (d.description) cands.push(d.description);
    if (Array.isArray(d.products)) d.products.forEach((p) => p && p.name && cands.push(p.name));
    const m = cands.join(" · ").match(/EFCA-\d{6}-[A-Z0-9]{4}/i);
    return m ? m[0].toUpperCase() : "";
  }

  const todayParis = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Index carte -> toutes ses transactions réussies (pour le rapprochement acompte/solde).
  const byCard = {};
  if (tx.ok) {
    tx.items
      .filter((t) => up(t.status) === "SUCCESSFUL")
      .forEach((t) => {
        const c = card4(t);
        if (!c) return;
        (byCard[c] = byCard[c] || []).push(t);
      });
  }

  // --- Bandeau ---
  let banner;
  if (health.works) {
    banner = `<div class="banner ok">✅ SumUp opérationnel — marchand ${esc(health.merchant || "?")}. Les acomptes par lien UNIQUE (« Acompte eFoil — EFCA-… ») remontent automatiquement.</div>`;
  } else if (health.connected) {
    banner = `<div class="banner ko">⛔ SumUp connecté mais le jeton ne répond pas. Reconnecter via /api/sumup/connect.</div>`;
  } else {
    banner = `<div class="banner ko">⛔ SumUp NON connecté. Autorise via /api/sumup/connect.</div>`;
  }

  let body = `<h1>Réconciliation des acomptes (50 €)</h1>` + banner;

  if (!tx.ok) {
    body += `<div class="card ko">Impossible de lire les transactions SumUp : ${esc(tx.error)}</div>`;
    return html(body);
  }

  // Partition : acomptes 50 € vs autres ventes.
  const deposits = tx.items.filter((t) => Math.round(amountNum(t.amount)) === DEPOSIT);
  const autres = tx.items.filter((t) => Math.round(amountNum(t.amount)) !== DEPOSIT);

  // --- 1. Tous les acomptes de 50 € ---
  const depRows = deposits
    .map((t) => {
      const st = up(t.status);
      const type = up(t.payment_type || t.type);
      const cls = st === "SUCCESSFUL" ? "b-ok" : st === "FAILED" || st === "CANCELLED" ? "b-ko" : "b-w";
      let origine;
      if (st !== "SUCCESSFUL") origine = `<span class="muted">—</span>`;
      else if (type === "POS") origine = `<span class="badge b-i">terminal (sur place)</span>`;
      else {
        const mp = matchedPaid(t); // rattaché en auto (paidAt ≈ heure du paiement)
        const ref = refOf(t);
        if (mp) origine = `<span class="api">rattaché ✓ ${esc(mp.ref)} ${esc(mp.name)}</span>`;
        else if (ref)
          origine = `<span class="api">API · ${esc(ref)}</span>` + (paidRefs.has(ref) ? ` <span class="badge b-ok">payé ✓</span>` : "");
        else origine = `<span class="fixe">à recouper</span>`;
      }
      // même carte utilisée ailleurs ?
      const c = card4(t);
      const autresC = c && byCard[c] ? byCard[c].filter((x) => keyOf(x) !== keyOf(t)) : [];
      const croise = autresC.length
        ? autresC
            .map((x) => `${fmt(x.timestamp || x.date)} ${money(x.amount, x.currency)} ${up(x.payment_type || x.type)}`)
            .join(" ; ")
        : "";
      return (
        `<tr><td>${esc(fmt(t.timestamp || t.date))}</td>` +
        `<td><span class="badge ${cls}">${esc(st)}</span></td>` +
        `<td>${esc(type || "—")}</td>` +
        `<td>${origine}</td>` +
        `<td>${st === "SUCCESSFUL" ? esc(cardStr(t)) || '<span class="muted">—</span>' : '<span class="muted">—</span>'}</td>` +
        `<td class="muted">${croise ? "↔ " + esc(croise) : "—"}</td>` +
        `<td class="muted">${esc(t.transaction_code || t.id || "—")}</td></tr>`
      );
    })
    .join("");
  const okDeposits = deposits.filter((t) => up(t.status) === "SUCCESSFUL");
  const onlineOk = okDeposits.filter((t) => up(t.payment_type || t.type) === "ECOM");
  const rattaches = onlineOk.filter((t) => matchedPaid(t) || (refOf(t) && paidRefs.has(refOf(t)))).length;
  const aRecouper = onlineOk.length - rattaches;
  const nbOk = okDeposits.length;
  body +=
    `<div class="banner b-w" style="font-weight:normal;">Acomptes 50 € payés EN LIGNE : <b>${onlineOk.length}</b> réussis · ` +
    `<b>${rattaches}</b> déjà rattachés en auto (à ignorer) · <b>${aRecouper}</b> À RECOUPER (les fantômes). ` +
    `Les paiements au terminal (POS) et les échecs ne comptent pas.</div>` +
    `<h2>1. Tous les acomptes de 50 € (${deposits.length} lignes · ${nbOk} réussis)</h2>` +
    `<div class="card"><table><tr><th>Quand (Paris)</th><th>Statut</th><th>Type</th>` +
    `<th>Origine</th><th>Carte</th><th>Même carte ailleurs</th><th>Code</th></tr>${depRows}</table>` +
    `<p class="muted">ECOM = payé en ligne (par un lien) · POS = payé au terminal sur place. ` +
    `« Même carte ailleurs » = la même carte a servi pour un autre paiement (ex. acompte en ligne + solde au ` +
    `terminal = même client). FAILED = aucun argent pris (client qui prétend avoir payé alors que refusé).</p></div>`;

  // --- 2. Réservations confirmées NON payées ---
  const cuRows = confirmedUnpaid
    .map((r) => {
      const passee = String(r.date) < todayParis;
      const flag = passee ? `<span class="badge b-w">séance passée</span>` : `<span class="badge b-ok">à venir</span>`;
      return (
        `<tr><td>${esc(r.ref)}</td><td>${esc(r.name || "—")}</td>` +
        `<td>${esc(r.date)} ${esc(r.slot)} ${flag}</td>` +
        `<td class="muted">${esc(r.status)}</td>` +
        `<td class="muted">${esc(r.phone || "—")}</td>` +
        `<td class="muted">créée ${esc(fmt(r.createdAt))}</td></tr>`
      );
    })
    .join("");
  body +=
    `<h2>2. Réservations non payées (${confirmedUnpaid.length}) — pour recouper</h2>` +
    (confirmedUnpaid.length
      ? `<div class="card"><table><tr><th>Réf</th><th>Client</th><th>Séance</th><th>Statut</th><th>Téléphone</th><th>Création</th></tr>${cuRows}</table></div>`
      : `<div class="card ok">Aucune réservation non payée. 👌</div>`);

  // --- 3. Autres ventes (hors acomptes) — repliées ---
  const autresRows = autres
    .map(
      (t) =>
        `<tr><td>${esc(fmt(t.timestamp || t.date))}</td><td><b>${esc(money(t.amount, t.currency))}</b></td>` +
        `<td>${esc(up(t.status))}</td><td>${esc(up(t.payment_type || t.type) || "—")}</td>` +
        `<td class="muted">${esc(t.transaction_code || t.id || "—")}</td></tr>`
    )
    .join("");
  body +=
    `<details><summary>Autres ventes hors acomptes (${autres.length}) — cliquer pour dérouler</summary>` +
    `<div class="card" style="margin-top:8px;"><table><tr><th>Quand</th><th>Montant</th><th>Statut</th><th>Type</th><th>Code</th></tr>${autresRows}</table></div></details>`;

  body += `<p class="muted" style="margin-top:12px;">Réservations déjà « Payé » : ${paidRefs.size}. <a class="back" href="/">← retour au dashboard</a></p>`;
  return html(body);
}
