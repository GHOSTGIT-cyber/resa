// Notifications serveur déclenchées à chaque réservation (WhatsApp + e-mail).
// Tout est OPTIONNEL et tolérant aux pannes (Promise.allSettled / try-catch).
// Le BRANDING est résolu PAR RÉSERVATION via son site (brandFor(r.siteId)) :
// un même déploiement peut donc envoyer des mails « eFoil Beauvallon » et
// « eFoil Croix-Valmer » selon le site d'arrivée. Les secrets/destinataires
// (SMTP, OWNER_EMAIL, WHATSAPP_*, BCC_ALL…) restent en variables d'environnement.
import { brandFor } from "./sites";
import { actionToken } from "./links";
import { sumupReady, payUrl } from "./sumup";

function dashboardUrl() {
  return process.env.DASHBOARD_URL || "https://resa.efoilcotedazur.fr";
}
function brandPhoto() {
  return process.env.BRAND_PHOTO || dashboardUrl() + "/mail-photo.jpg";
}
// "06 35 30 50 67" ou "+33 7 49 19 70 38" -> lien tel: normalisé "+33..."
function telHref(phone) {
  const d = String(phone || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("0")) return "+33" + d.slice(1);
  return d;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
// Gros bouton d'action (compatible mail) — centré, arrondi, orange marque.
function bigButton(href, label) {
  return (
    `<p style="margin:20px 0 4px;text-align:center;">` +
    `<a href="${href}" style="display:inline-block;background:#F4631F;color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:999px;font-weight:bold;font-size:16px;">${label}</a>` +
    `</p>`
  );
}
// URL publique signée du bouton « Confirmer ma réservation » (idempotent, infalsifiable).
function confirmUrl(r) {
  return `${dashboardUrl()}/confirm?ref=${encodeURIComponent(r.ref)}&t=${actionToken(r.ref, "confirm")}`;
}
// Lien de paiement SumUp (par déploiement) + libellé du montant.
function paymentLink() {
  return process.env.SUMUP_PAYMENT_LINK || "";
}
// Encart "payer l'acompte". Lien = page /pay (crée le checkout au clic, statut "Payé"
// automatique) si l'API SumUp est connectée ; sinon le lien fixe SUMUP_PAYMENT_LINK.
// Vide si rien de configuré (dégrade proprement).
function paymentBlock(r) {
  const link = r && sumupReady() ? payUrl(r.ref) : paymentLink();
  if (!link) return "";
  const amount = process.env.SUMUP_AMOUNT || "50 €";
  return (
    `<div style="margin-top:16px;padding:16px;background:#FCF8F3;border-radius:10px;text-align:center;">` +
    `<p style="margin:0;font-size:15px;color:#0F2830;">Pour finaliser votre réservation, réglez l'acompte de <b>${esc(amount)}</b> :</p>` +
    bigButton(link, `Payer l'acompte de ${esc(amount)}`) +
    `<p style="margin:4px 0 0;font-size:12px;color:#5B6B6E;">Paiement 100% sécurisé via SumUp.</p>` +
    `</div>`
  );
}

// ---------- WhatsApp (CallMeBot) ----------

function waRecipients() {
  const out = [];
  const suffixes = [""];
  for (let i = 2; i <= 20; i++) suffixes.push(String(i));
  for (const suffix of suffixes) {
    const phone = process.env["WHATSAPP_PHONE" + suffix];
    const apikey = process.env["WHATSAPP_APIKEY" + suffix];
    if (phone && apikey) out.push({ phone, apikey });
  }
  return out;
}

function waText(r, b) {
  const lines = [
    `Nouvelle reservation - ${b.name}`,
    `Ref : ${r.ref}`,
    `Nom : ${r.name}`,
    `Participants : ${r.participants} (niveau ${r.level || "-"})`,
    `Formule : ${r.formule || "-"}`,
    `Date : ${r.date} ${r.slot}`,
    `Tel : ${r.phone || "-"}`,
    `E-mail : ${r.email || "-"}`,
  ];
  if (r.message) lines.push(`Message : ${r.message}`);
  lines.push(`Dashboard : ${dashboardUrl()}`);
  return lines.join("\n");
}

async function sendWhatsApp(r, b) {
  const recips = waRecipients();
  if (!recips.length) {
    console.warn("[notify] WhatsApp : aucun destinataire configuré (PHONE/APIKEY manquant)");
    return;
  }
  const text = waText(r, b);
  await Promise.allSettled(
    recips.map(async ({ phone, apikey }) => {
      const url =
        `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
        `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
      try {
        const res = await fetch(url);
        const body = (await res.text().catch(() => ""))
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        console.log(`[notify] WhatsApp ${phone} -> HTTP ${res.status} | ${body}`);
      } catch (e) {
        console.error(`[notify] WhatsApp ${phone} ÉCHEC : ${e?.message || e}`);
      }
    })
  );
}

// ---------- E-mail (SMTP via nodemailer) ----------

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Encart "avis Google" — masqué si la marque n'a pas de lien.
function googleBox(b) {
  if (!b.googleReview) return "";
  return (
    `<tr><td style="padding:0 28px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;"><tr><td align="center" style="padding:14px;">` +
    `<div style="font-size:15px;color:#0F2830;">&#11088;&#11088;&#11088;&#11088;&#11088; <b>5,0</b> &middot; 232 avis Google</div>` +
    `<a href="${b.googleReview}" style="display:inline-block;margin-top:6px;font-size:13px;color:#F4631F;text-decoration:none;font-weight:bold;">Voir nos avis Google &rarr;</a>` +
    `</td></tr></table></td></tr>`
  );
}

function emailShell(inner, b) {
  const phoneHref = telHref(b.phone);
  return (
    `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#eef2f2;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f2;padding:24px 0;"><tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">` +
    `<tr><td align="center" style="padding:22px 20px 14px;"><img src="${b.logo}" alt="${esc(b.name)}" width="160" style="display:block;height:auto;max-width:160px;"></td></tr>` +
    `<tr><td><img src="${brandPhoto()}" alt="Rider en eFoil" width="600" style="display:block;width:100%;height:auto;"></td></tr>` +
    inner +
    `<tr><td align="center" style="padding:16px 24px;background:#0F2830;color:#bfe3ea;font-size:12px;line-height:1.6;">${esc(b.name)} — ${esc(b.footer)} &middot; <a href="tel:${phoneHref}" style="color:#bfe3ea;">${esc(b.phone)}</a></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

// E-mail de RÉCEPTION envoyé AU CLIENT (sur r.email)
function clientEmailHtml(r, b) {
  const row = (k, v) =>
    `<tr><td style="padding:9px 14px;color:#5B6B6E;font-size:14px;">${k}</td><td style="padding:9px 14px;text-align:right;font-size:14px;"><b>${esc(v)}</b></td></tr>`;
  const inner =
    `<tr><td style="padding:24px 28px 8px;color:#0F2830;">` +
    `<h1 style="margin:0 0 10px;font-size:22px;color:#F4631F;">Merci ${esc(r.name)} ! &#127754;</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Nous avons bien reçu votre <b>demande de réservation eFoil</b>. Vous recevrez une <b>confirmation sous 48 heures</b>, selon les disponibilités. Merci de votre patience !</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCF8F3;border-radius:10px;">` +
    row("Formule", r.formule) +
    row("Date &amp; créneau", `${r.date} à ${r.slot}`) +
    row("Participants", r.participants) +
    row("Référence", r.ref) +
    (r.message ? row("Votre message", r.message) : "") +
    `</table>` +
    `<p style="margin:16px 0 0;font-size:13px;color:#5B6B6E;"><i>Aucun paiement n'a été effectué</i> — demande sans engagement.<br>E-mail automatique, merci de ne pas y répondre.</p>` +
    `</td></tr>` +
    googleBox(b);
  return emailShell(inner, b);
}

// E-mail de NOTIFICATION envoyé AU GÉRANT (sur OWNER_EMAIL)
function ownerEmailHtml(r, b) {
  const row = (k, v) =>
    `<tr><td style="padding:7px 14px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;font-size:13px;width:38%;">${k}</td><td style="padding:7px 14px;border:1px solid #e5e7eb;font-size:13px;">${esc(v) || "—"}</td></tr>`;
  const inner =
    `<tr><td style="padding:24px 28px 8px;color:#0F2830;">` +
    `<h1 style="margin:0 0 14px;font-size:21px;color:#F4631F;">&#128276; Nouvelle réservation — ${esc(b.name)}</h1>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    row("Référence", r.ref) +
    row("Nom", r.name) +
    row("Téléphone", r.phone) +
    row("E-mail", r.email) +
    row("Formule", r.formule) +
    row("Date", r.date) +
    row("Créneau", r.slot) +
    row("Participants", r.participants) +
    row("Niveau", r.level) +
    row("Message", r.message) +
    `</table>` +
    `<p style="margin:18px 0 4px;"><a href="${dashboardUrl()}" style="display:inline-block;background:#F4631F;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:bold;font-size:14px;">Ouvrir le dashboard &rarr;</a></p>` +
    `</td></tr>` +
    googleBox(b);
  return emailShell(inner, b);
}

// E-mail de VALIDATION envoyé AU CLIENT quand le gérant confirme.
function confirmedEmailHtml(r, b, opts) {
  const row = (k, v) =>
    `<tr><td style="padding:9px 14px;color:#5B6B6E;font-size:14px;">${k}</td><td style="padding:9px 14px;text-align:right;font-size:14px;"><b>${esc(v)}</b></td></tr>`;
  const inner =
    `<tr><td style="padding:24px 28px 8px;color:#0F2830;">` +
    `<h1 style="margin:0 0 10px;font-size:22px;color:#F4631F;">Réservation confirmée &#9989;</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Bonne nouvelle ${esc(r.name)} ! Votre session eFoil est <b>confirmée</b>. On vous attend :</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCF8F3;border-radius:10px;">` +
    row("Formule", r.formule) +
    row("Date &amp; créneau", `${r.date} à ${r.slot}`) +
    row("Participants", r.participants) +
    row("Référence", r.ref) +
    `</table>` +
    (opts && opts.withPayment ? paymentBlock(r) : "") +
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;">Une question ou un imprévu ? Répondez à cet e-mail ou appelez le <a href="tel:${telHref(b.phone)}" style="color:#F4631F;">${esc(b.phone)}</a>.</p>` +
    `</td></tr>` +
    googleBox(b);
  return emailShell(inner, b);
}

// E-mail de PROPOSITION d'un autre créneau, envoyé au client. p = { date, slot, message }
function proposalEmailHtml(r, b, p) {
  const row = (k, v) =>
    `<tr><td style="padding:9px 14px;color:#5B6B6E;font-size:14px;">${k}</td><td style="padding:9px 14px;text-align:right;font-size:14px;"><b>${esc(v)}</b></td></tr>`;
  const msg = esc(p.message || "").replace(/\n/g, "<br>");
  const inner =
    `<tr><td style="padding:24px 28px 8px;color:#0F2830;">` +
    `<h1 style="margin:0 0 10px;font-size:22px;color:#F4631F;">Proposition de créneau</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Bonjour ${esc(r.name)},<br>${msg}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCF8F3;border-radius:10px;">` +
    row("Nouveau créneau proposé", `${esc(p.date)} à ${esc(p.slot)}`) +
    row("Formule", r.formule) +
    row("Participants", r.participants) +
    row("Référence", r.ref) +
    `</table>` +
    `<p style="margin:16px 0 0;font-size:15px;line-height:1.6;">Ce créneau vous convient ? <b>Confirmez en un clic</b> :</p>` +
    bigButton(confirmUrl(r), "&#9989; Confirmer ma r&eacute;servation") +
    `<p style="margin:12px 0 0;font-size:13px;color:#5B6B6E;line-height:1.6;">Un empêchement ou une question ? Répondez à cet e-mail ou appelez le <a href="tel:${telHref(b.phone)}" style="color:#F4631F;">${esc(b.phone)}</a>.</p>` +
    `</td></tr>` +
    googleBox(b);
  return emailShell(inner, b);
}

// E-mail d'ANNULATION envoyé au client.
function cancelEmailHtml(r, b) {
  const row = (k, v) =>
    `<tr><td style="padding:9px 14px;color:#5B6B6E;font-size:14px;">${k}</td><td style="padding:9px 14px;text-align:right;font-size:14px;"><b>${esc(v)}</b></td></tr>`;
  const inner =
    `<tr><td style="padding:24px 28px 8px;color:#0F2830;">` +
    `<h1 style="margin:0 0 10px;font-size:22px;color:#F4631F;">Réservation annulée</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Bonjour ${esc(r.name)}, votre réservation eFoil a été <b>annulée</b>. Si c'est une erreur ou pour reprogrammer, contactez-nous, on s'en occupe avec plaisir.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCF8F3;border-radius:10px;">` +
    row("Date &amp; créneau", `${r.date} à ${r.slot}`) +
    row("Référence", r.ref) +
    `</table>` +
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;">Répondez à cet e-mail ou appelez le <a href="tel:${telHref(b.phone)}" style="color:#F4631F;">${esc(b.phone)}</a>.</p>` +
    `</td></tr>` +
    googleBox(b);
  return emailShell(inner, b);
}

// E-mail envoyé À L'ÉQUIPE quand le CLIENT clique « Confirmer ma réservation ».
function acceptedNoticeHtml(r, b) {
  const row = (k, v) =>
    `<tr><td style="padding:7px 14px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;font-size:13px;width:38%;">${k}</td><td style="padding:7px 14px;border:1px solid #e5e7eb;font-size:13px;">${esc(v) || "—"}</td></tr>`;
  const inner =
    `<tr><td style="padding:24px 28px 8px;color:#0F2830;">` +
    `<h1 style="margin:0 0 14px;font-size:21px;color:#F4631F;">&#9989; Le client a CONFIRMÉ — ${esc(b.name)}</h1>` +
    `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;">La réservation est passée en <b>Confirmée</b> dans le tableau. Aucune action requise.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    row("Référence", r.ref) +
    row("Nom", r.name) +
    row("Téléphone", r.phone) +
    row("E-mail", r.email) +
    row("Formule", r.formule) +
    row("Date", r.date) +
    row("Créneau", r.slot) +
    row("Participants", r.participants) +
    `</table>` +
    `<p style="margin:18px 0 4px;"><a href="${dashboardUrl()}" style="display:inline-block;background:#F4631F;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:bold;font-size:14px;">Ouvrir le dashboard &rarr;</a></p>` +
    `</td></tr>`;
  return emailShell(inner, b);
}

// Transport SMTP partagé (ou null si non configuré).
async function makeTransport() {
  if (!smtpConfigured()) return null;
  const nodemailer = (await import("nodemailer")).default;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE ?? "true") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

function senderFrom(b) {
  return `"${b.name}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`;
}

// Copie cachée : BCC_ALL = archive globale (reçoit TOUT, mails clients inclus).
// includeOwner = ajoute OWNER_EMAIL (trace pour le gérant) — en BCC donc invisible du client.
function bccFor(includeOwner) {
  const list = [];
  if (includeOwner && process.env.OWNER_EMAIL) list.push(process.env.OWNER_EMAIL);
  if (process.env.BCC_ALL) list.push(process.env.BCC_ALL);
  return list.length ? list.join(", ") : undefined;
}

async function sendEmails(r) {
  const b = brandFor(r.siteId);
  const transport = await makeTransport();
  if (!transport) {
    console.warn(
      "[notify] SMTP non configuré (SMTP_HOST / SMTP_USER / SMTP_PASS manquant) — e-mail ignoré"
    );
    return;
  }
  try {
    const from = senderFrom(b);
    const jobs = [];
    if (process.env.OWNER_EMAIL) {
      jobs.push({
        label: "gérant",
        p: transport.sendMail({
          from,
          to: process.env.OWNER_EMAIL,
          bcc: bccFor(false),
          replyTo: r.email || process.env.EMAIL_REPLY_TO,
          subject: `Nouvelle réservation ${b.name} — ${r.name} (${r.date} ${r.slot})`,
          html: ownerEmailHtml(r, b),
        }),
      });
    }
    if (r.email) {
      jobs.push({
        label: "client",
        p: transport.sendMail({
          from,
          to: r.email,
          bcc: bccFor(false),
          replyTo: process.env.EMAIL_REPLY_TO || undefined,
          subject: `Votre réservation ${b.name} — ${r.ref}`,
          html: clientEmailHtml(r, b),
        }),
      });
    }
    const results = await Promise.allSettled(jobs.map((j) => j.p));
    results.forEach((res, i) => {
      const label = jobs[i].label;
      if (res.status === "fulfilled") {
        console.log(`[notify] e-mail ${label} OK (${res.value?.messageId || "envoyé"})`);
      } else {
        console.error(`[notify] e-mail ${label} ÉCHEC :`, res.reason?.message || res.reason);
      }
    });
  } catch (e) {
    console.error("[notify] e-mail erreur générale :", e?.message || e);
  }
}

// Point d'entrée : déclenche tous les canaux, n'échoue jamais.
export async function notify(reservation) {
  const b = brandFor(reservation.siteId);
  await Promise.allSettled([sendWhatsApp(reservation, b), sendEmails(reservation)]);
}

// Envoi ponctuel d'un e-mail au client, avec gabarit choisi. Renvoie { ok, error? }.
async function sendClientMail(r, kind, extra) {
  if (!r?.email) return { ok: false, error: "réservation sans e-mail client" };
  const transport = await makeTransport();
  if (!transport) return { ok: false, error: "SMTP non configuré" };
  const b = brandFor(r.siteId);
  const builders = {
    confirmation: { subject: `Réservation confirmée — ${b.name} (${r.ref})`, html: () => confirmedEmailHtml(r, b, extra) },
    proposition: { subject: `Proposition de créneau — ${b.name} (${r.ref})`, html: () => proposalEmailHtml(r, b, extra) },
    annulation: { subject: `Réservation annulée — ${b.name} (${r.ref})`, html: () => cancelEmailHtml(r, b) },
  }[kind];
  try {
    await transport.sendMail({
      from: senderFrom(b),
      to: r.email,
      bcc: bccFor(true), // gérant (trace) + archive globale, invisibles du client
      replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || process.env.SMTP_USER,
      subject: builders.subject,
      html: builders.html(),
    });
    console.log(`[notify] e-mail ${kind} client OK (${r.ref})`);
    return { ok: true };
  } catch (e) {
    console.error(`[notify] e-mail ${kind} ÉCHEC :`, e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export function sendConfirmation(r, opts) {
  return sendClientMail(r, "confirmation", opts);
}

// Prévient l'ÉQUIPE (OWNER_EMAIL + archives BCC) que le client a confirmé via le bouton.
export async function sendClientAcceptedNotice(r) {
  const transport = await makeTransport();
  if (!transport) return { ok: false, error: "SMTP non configuré" };
  if (!process.env.OWNER_EMAIL) return { ok: false, error: "OWNER_EMAIL manquant" };
  const b = brandFor(r.siteId);
  try {
    await transport.sendMail({
      from: senderFrom(b),
      to: process.env.OWNER_EMAIL,
      bcc: bccFor(false), // archive globale (BCC_ALL) ; OWNER déjà en destinataire
      replyTo: r.email || process.env.EMAIL_REPLY_TO,
      subject: `✅ Client a CONFIRMÉ — ${b.name} — ${r.name} (${r.date} ${r.slot})`,
      html: acceptedNoticeHtml(r, b),
    });
    console.log(`[notify] notif équipe "client a confirmé" OK (${r.ref})`);
    return { ok: true };
  } catch (e) {
    console.error(`[notify] notif "client a confirmé" ÉCHEC :`, e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
export function sendProposal(r, p) {
  if (!p?.date || !p?.slot) return Promise.resolve({ ok: false, error: "créneau proposé manquant" });
  return sendClientMail(r, "proposition", p);
}
export function sendCancellation(r) {
  return sendClientMail(r, "annulation");
}
