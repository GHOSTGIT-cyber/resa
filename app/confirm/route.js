// Page PUBLIQUE de confirmation en un clic pour le client.
// Lien signé reçu dans le mail de proposition : /confirm?ref=...&t=<jeton HMAC>
//  - GET  : affiche un récap + un BOUTON (form POST) — le POST évite qu'un
//           anti-virus/scanner de liens (qui fait un GET) confirme tout seul.
//  - POST : vérifie le jeton, passe la résa en « Confirmée », adopte le créneau
//           proposé, puis envoie les mails (confirmation client + notif équipe).
import { readAll, update, setStatus } from "../../lib/store";
import { verifyActionToken } from "../../lib/links";
import { brandFor } from "../../lib/sites";
import { sendConfirmation, sendClientAcceptedNotice } from "../../lib/notify";
import { upsertReservationEvent } from "../../lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function fmtDate(d) {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d || "—";
}
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
// Coquille branding (logo + couleurs marque), même identité que les mails.
function page(b, inner) {
  return (
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(b.name)} — Réservation</title></head>` +
    `<body style="margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;">` +
    `<div style="max-width:520px;margin:40px auto;padding:0 16px;">` +
    `<div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(15,40,48,.08);">` +
    `<div style="text-align:center;padding:24px 20px 8px;"><img src="${b.logo}" alt="${esc(b.name)}" width="150" style="max-width:150px;height:auto;"></div>` +
    inner +
    `<div style="text-align:center;padding:16px 24px;background:#0F2830;color:#bfe3ea;font-size:12px;">${esc(b.name)} — ${esc(b.footer)}</div>` +
    `</div></div></body></html>`
  );
}
function block(inner) {
  return `<div style="padding:8px 28px 26px;color:#0F2830;">${inner}</div>`;
}
function summary(targetDate, targetSlot, r) {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCF8F3;border-radius:10px;margin-top:8px;">` +
    `<tr><td style="padding:9px 14px;color:#5B6B6E;font-size:14px;">Date &amp; créneau</td><td style="padding:9px 14px;text-align:right;font-size:14px;"><b>${esc(fmtDate(targetDate))} à ${esc(targetSlot)}</b></td></tr>` +
    `<tr><td style="padding:9px 14px;color:#5B6B6E;font-size:14px;">Formule</td><td style="padding:9px 14px;text-align:right;font-size:14px;"><b>${esc(r.formule) || "—"}</b></td></tr>` +
    `<tr><td style="padding:9px 14px;color:#5B6B6E;font-size:14px;">Référence</td><td style="padding:9px 14px;text-align:right;font-size:14px;"><b>${esc(r.ref)}</b></td></tr>` +
    `</table>`
  );
}

function findByRef(ref) {
  return readAll().find((x) => x.ref === ref) || null;
}
function invalidPage() {
  const b = brandFor(null);
  return html(
    page(
      b,
      block(
        `<h1 style="font-size:22px;color:#F4631F;margin:8px 0 10px;">Lien invalide ou expiré</h1>` +
          `<p style="font-size:15px;line-height:1.6;">Ce lien de confirmation n'est pas valide. Répondez à l'e-mail reçu ou contactez-nous par téléphone, on s'occupe de tout.</p>`
      )
    ),
    400
  );
}

// ---- GET : récap + bouton ----
export async function GET(request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref");
  const t = url.searchParams.get("t");
  if (!verifyActionToken(ref, "confirm", t)) return invalidPage();
  const r = findByRef(ref);
  if (!r) return invalidPage();
  const b = brandFor(r.siteId);
  const targetDate = r.proposedDate || r.date;
  const targetSlot = r.proposedSlot || r.slot;

  if (r.status === "confirmed") {
    return html(
      page(
        b,
        block(
          `<h1 style="font-size:22px;color:#F4631F;margin:8px 0 10px;">Déjà confirmée &#9989;</h1>` +
            `<p style="font-size:15px;line-height:1.6;">Votre réservation est déjà confirmée. À très vite !</p>` +
            summary(targetDate, targetSlot, r)
        )
      )
    );
  }

  const inner = block(
    `<h1 style="font-size:22px;color:#F4631F;margin:8px 0 10px;">Confirmer votre réservation</h1>` +
      `<p style="font-size:15px;line-height:1.6;">Bonjour ${esc(r.name)}, cliquez sur le bouton pour <b>confirmer</b> ce créneau. Vous recevrez un e-mail de confirmation.</p>` +
      summary(targetDate, targetSlot, r) +
      `<form method="POST" action="/confirm" style="text-align:center;margin-top:20px;">` +
      `<input type="hidden" name="ref" value="${esc(r.ref)}">` +
      `<input type="hidden" name="t" value="${esc(t)}">` +
      `<button type="submit" style="background:#F4631F;color:#fff;border:0;cursor:pointer;padding:14px 30px;border-radius:999px;font-weight:bold;font-size:16px;">&#9989; Confirmer ma réservation</button>` +
      `</form>`
  );
  return html(page(b, inner));
}

// ---- POST : exécute la confirmation ----
export async function POST(request) {
  let ref = "";
  let t = "";
  try {
    const form = await request.formData();
    ref = String(form.get("ref") || "");
    t = String(form.get("t") || "");
  } catch {
    /* body illisible */
  }
  if (!verifyActionToken(ref, "confirm", t)) return invalidPage();
  const r = findByRef(ref);
  if (!r) return invalidPage();
  const b = brandFor(r.siteId);

  // Idempotent : si déjà confirmée, on n'envoie pas les mails une 2e fois.
  const already = r.status === "confirmed";
  if (!already) {
    // Le client accepte le créneau PROPOSÉ : on l'adopte comme créneau officiel.
    if (r.proposedDate && r.proposedSlot) {
      update(ref, { date: r.proposedDate, slot: r.proposedSlot });
    }
    setStatus(ref, "confirmed");
    const fresh = findByRef(ref) || r;
    // Mails « dans tous les sens » + event agenda (best-effort, ne bloque pas la page).
    await Promise.allSettled([
      sendConfirmation(fresh),
      sendClientAcceptedNotice(fresh),
      upsertReservationEvent(fresh),
    ]);
  }

  const r2 = findByRef(ref) || r;
  const inner = block(
    `<h1 style="font-size:22px;color:#F4631F;margin:8px 0 10px;">C'est confirmé ! &#127881;</h1>` +
      `<p style="font-size:15px;line-height:1.6;">Merci ${esc(r2.name)}, votre réservation est <b>confirmée</b>. Un e-mail de confirmation vous a été envoyé. On vous attend !</p>` +
      summary(r2.date, r2.slot, r2)
  );
  return html(page(b, inner));
}
