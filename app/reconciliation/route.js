// Page RÉCONCILIATION (protégée par le mot de passe du dashboard).
// Elle tourne DANS le conteneur -> elle a accès au jeton SumUp de Nico (fichier volume),
// le seul qui peut lire les VRAIES transactions encaissées. Objectif : ne JAMAIS rater un
// paiement. Elle affiche :
//   1) l'état du jeton (fonctionne-t-il ? sinon rien ne remonte automatiquement) ;
//   2) la liste RÉELLE des paiements SumUp, avec pour chaque paiement en ligne (ECOM) son
//      LIBELLÉ : « Acompte eFoil — EFCA-… » = passé par NOTRE API (auto, traçable) ;
//      « Accompte de réservation » (générique) = lien FIXE = fantôme non identifiable ;
//   3) les réservations confirmées NON payées, avec date de séance + heure de création,
//      pour recouper à la main (timing) les fantômes du lien fixe.
import { cookies } from "next/headers";
import { COOKIE, isAuthed } from "../../lib/auth";
import { readAll } from "../../lib/store";
import { enabledSiteIds, defaultSiteId } from "../../lib/sites";
import { tokenHealth, listTransactions, getTransactionDetail } from "../../lib/sumup";

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
      `.wrap{max-width:1040px;margin:24px auto;padding:0 16px;}` +
      `h1{font-size:22px;color:#F4631F;}h2{font-size:17px;margin:26px 0 8px;}` +
      `.card{background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 4px 16px rgba(15,40,48,.07);overflow-x:auto;}` +
      `.ok{background:#e6f7ec;color:#1a7f4b;}.ko{background:#fdecea;color:#c0392b;}` +
      `.banner{border-radius:10px;padding:14px 16px;font-weight:bold;margin-bottom:14px;}` +
      `table{width:100%;border-collapse:collapse;font-size:13px;}` +
      `th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap;}` +
      `th{background:#f7fafa;color:#5B6B6E;font-size:12px;}` +
      `.badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:bold;}` +
      `.b-ok{background:#e6f7ec;color:#1a7f4b;}.b-ko{background:#fdecea;color:#c0392b;}.b-w{background:#fff4e5;color:#b26a00;}` +
      `.muted{color:#5B6B6E;font-size:12px;}a.back{color:#F4631F;text-decoration:none;font-weight:bold;}` +
      `.api{color:#1a7f4b;font-weight:bold;}.fixe{color:#c0392b;font-weight:bold;}` +
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
function up(v) {
  return String(v || "").toUpperCase();
}

export async function GET() {
  if (!isAuthed(cookies().get(COOKIE)?.value)) {
    return html(
      `<h1>Réconciliation paiements</h1><div class="card">Connecte-toi d'abord au ` +
        `<a class="back" href="/">dashboard</a> (même domaine), puis reviens sur cette page.</div>`,
      401
    );
  }

  const health = await tokenHealth();
  const tx = await listTransactions(50);
  const enabled = enabledSiteIds();
  const resas = readAll().filter((r) => enabled.includes(r.siteId || defaultSiteId()));
  const paidRefs = new Set(resas.filter((r) => r.paid).map((r) => r.ref));
  const confirmedUnpaid = resas
    .filter((r) => r.status === "confirmed" && !r.paid)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // On va chercher le libellé des paiements EN LIGNE (ECOM) réussis : c'est lui qui révèle
  // si le paiement est passé par NOTRE API (contient « EFCA-… ») ou par le lien fixe.
  const details = {};
  if (tx.ok) {
    const ecom = tx.items
      .filter((t) => up(t.payment_type || t.type) === "ECOM" && up(t.status) === "SUCCESSFUL")
      .slice(0, 30);
    await Promise.all(
      ecom.map(async (t) => {
        const key = t.id || t.transaction_code;
        details[key] = await getTransactionDetail(key);
      })
    );
  }
  function refLabel(t) {
    const d = details[t.id || t.transaction_code];
    if (!d) return { text: "", ref: "" };
    const cands = [];
    if (d.checkout_reference) cands.push(d.checkout_reference);
    if (d.description) cands.push(d.description);
    if (Array.isArray(d.products)) d.products.forEach((p) => p && p.name && cands.push(p.name));
    const joined = cands.join(" · ");
    const m = joined.match(/EFCA-\d{6}-[A-Z0-9]{4}/i);
    return { text: joined, ref: m ? m[0].toUpperCase() : "" };
  }
  // 4 derniers chiffres + marque de carte (pour faire citer le client — dernier recours).
  function cardInfo(t) {
    const d = details[t.id || t.transaction_code];
    const c = d && d.card;
    if (!c) return "";
    const l4 = c.last_4_digits || c.last4 || "";
    const brand = c.type || "";
    return (l4 ? "•••• " + l4 : "") + (brand ? " " + brand : "");
  }
  // Aujourd'hui en heure de Paris (YYYY-MM-DD) pour dire séance passée / à venir.
  const todayParis = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // --- Bandeau verdict ---
  let banner;
  if (health.works) {
    banner =
      `<div class="banner ok">✅ SumUp opérationnel — marchand ${esc(health.merchant || "?")}. ` +
      `Les paiements par lien UNIQUE (« Acompte eFoil — EFCA-… ») remontent automatiquement.</div>`;
  } else if (health.connected) {
    banner =
      `<div class="banner ko">⛔ SumUp connecté MAIS le jeton ne répond pas. Aucun paiement ne remonte ` +
      `automatiquement — reconnecter via /api/sumup/connect.</div>`;
  } else {
    banner = `<div class="banner ko">⛔ SumUp NON connecté. Autorise via /api/sumup/connect.</div>`;
  }

  // --- Tableau des paiements SumUp ---
  let txHtml;
  let phantomCount = 0;
  if (!tx.ok) {
    txHtml = `<div class="card ko">Impossible de lire les transactions SumUp : ${esc(tx.error)}</div>`;
  } else if (!tx.items.length) {
    txHtml = `<div class="card">Aucune transaction retournée par SumUp.</div>`;
  } else {
    const rows = tx.items
      .map((t) => {
        const st = up(t.status);
        const cls = st === "SUCCESSFUL" ? "b-ok" : st === "FAILED" || st === "CANCELLED" ? "b-ko" : "b-w";
        const type = up(t.payment_type || t.type);
        // Origine : seulement pertinent pour les paiements EN LIGNE réussis.
        let origine = '<span class="muted">—</span>';
        if (type === "ECOM" && st === "SUCCESSFUL") {
          const { ref } = refLabel(t);
          if (ref) {
            const dejaPaye = paidRefs.has(ref);
            origine =
              `<span class="api">API · ${esc(ref)}</span>` +
              (dejaPaye ? ` <span class="badge b-ok">résa payée ✓</span>` : ` <span class="badge b-ko">résa NON marquée !</span>`);
          } else {
            phantomCount++;
            origine = `<span class="fixe">lien fixe — non identifié</span>`;
          }
        }
        const carte = type === "ECOM" && st === "SUCCESSFUL" ? esc(cardInfo(t)) : "";
        return (
          `<tr><td>${esc(fmt(t.timestamp || t.date))}</td>` +
          `<td><b>${esc(money(t.amount, t.currency))}</b></td>` +
          `<td><span class="badge ${cls}">${esc(st || "?")}</span></td>` +
          `<td>${esc(type || "—")}</td>` +
          `<td>${origine}</td>` +
          `<td>${carte || '<span class="muted">—</span>'}</td>` +
          `<td class="muted">${esc(t.transaction_code || t.id || "—")}</td></tr>`
        );
      })
      .join("");
    txHtml =
      `<div class="card"><table><tr><th>Quand (Paris)</th><th>Montant</th><th>Statut</th>` +
      `<th>Type</th><th>Origine (en ligne)</th><th>Carte</th><th>Code SumUp</th></tr>${rows}</table>` +
      `<p class="muted">ECOM = paiement en ligne · POS = terminal au local (pas un acompte de résa). ` +
      `« API · EFCA-… » = passé par notre lien unique (traçable). « lien fixe » = acompte encaissé mais ` +
      `sans référence : à recouper avec les réservations ci-dessous.</p></div>`;
  }

  // --- Réservations confirmées NON payées (pour recouper par timing) ---
  const cuRows = confirmedUnpaid
    .map((r) => {
      const passee = String(r.date) < todayParis;
      const flag = passee
        ? `<span class="badge b-w">séance passée</span>`
        : `<span class="badge b-ok">à venir</span>`;
      return (
        `<tr><td>${esc(r.ref)}</td><td>${esc(r.name || "—")}</td>` +
        `<td>${esc(r.date)} ${esc(r.slot)} ${flag}</td>` +
        `<td class="muted">${esc(r.phone || "—")}</td>` +
        `<td class="muted">créée ${esc(fmt(r.createdAt))}</td></tr>`
      );
    })
    .join("");
  const cuHtml = confirmedUnpaid.length
    ? `<div class="card"><table><tr><th>Réf</th><th>Client</th><th>Séance</th><th>Téléphone</th><th>Création</th></tr>${cuRows}</table></div>`
    : `<div class="card ok">Aucune réservation confirmée en attente de paiement. 👌</div>`;

  const phantomNote = phantomCount
    ? `<div class="banner b-w" style="font-weight:normal;">⚠️ ${phantomCount} acompte(s) en ligne « lien fixe » sans référence : ` +
      `paiements réels mais non rattachables automatiquement. À recouper par timing (heure du paiement ↔ séance/création).</div>`
    : "";

  const body =
    `<h1>Réconciliation des paiements</h1>` +
    banner +
    phantomNote +
    `<h2>1. Paiements réellement encaissés sur SumUp (${tx.ok ? tx.items.length : 0})</h2>` +
    txHtml +
    `<h2>2. Réservations confirmées NON marquées « Payé » (${confirmedUnpaid.length})</h2>` +
    cuHtml +
    `<p class="muted" style="margin-top:10px;">Réservations déjà « Payé » : ${paidRefs.size}. ` +
    `<a class="back" href="/">← retour au dashboard</a></p>`;

  return html(body);
}
