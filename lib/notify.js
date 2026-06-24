// Notifications serveur déclenchées à chaque réservation (WhatsApp + e-mail).
// Tout est OPTIONNEL et tolérant aux pannes (Promise.allSettled / try-catch).
// L'identité de marque est pilotée par variables d'environnement (BRAND_*),
// avec des valeurs par défaut = eFoil Côte d'Azur → le code est réutilisable
// tel quel pour les autres sites (Beauvallon, Croix-Valmer…).

// ---------- Identité de marque (par déploiement) ----------
const BRAND_NAME = process.env.BRAND_NAME || "eFoil Côte d'Azur";
const BRAND_SITE = process.env.BRAND_SITE || "https://efoilcotedazur.fr";
const BRAND_LOGO =
  process.env.BRAND_LOGO || "https://efoilcotedazur.fr/wp-content/uploads/2026/06/efca-logo.webp";
const BRAND_PHONE = process.env.BRAND_PHONE || "06 35 30 50 67";
const BRAND_FOOTER = process.env.BRAND_FOOTER || "Mandelieu-la-Napoule & baie de Cannes";
// Lien avis Google : masqué si vide. `??` => variable absente = défaut CdA ;
// variable définie vide (BRAND_GOOGLE_REVIEW=) = encart masqué (Beauvallon/Croix-Valmer).
const BRAND_GOOGLE_REVIEW =
  process.env.BRAND_GOOGLE_REVIEW ?? "https://maps.app.goo.gl/SmZHJVCmXBzgBV7b9";

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

// ---------- WhatsApp (CallMeBot) ----------

function waRecipients() {
  const out = [];
  // WHATSAPP_PHONE (n°1) puis WHATSAPP_PHONE2 .. WHATSAPP_PHONE20 (chacun sa clé apikey).
  const suffixes = [""];
  for (let i = 2; i <= 20; i++) suffixes.push(String(i));
  for (const suffix of suffixes) {
    const phone = process.env["WHATSAPP_PHONE" + suffix];
    const apikey = process.env["WHATSAPP_APIKEY" + suffix];
    if (phone && apikey) out.push({ phone, apikey });
  }
  return out;
}

function waText(r) {
  const lines = [
    `Nouvelle reservation - ${BRAND_NAME}`,
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

async function sendWhatsApp(r) {
  const recips = waRecipients();
  if (!recips.length) {
    console.warn("[notify] WhatsApp : aucun destinataire configuré (PHONE/APIKEY manquant)");
    return;
  }
  const text = waText(r);
  await Promise.allSettled(
    recips.map(async ({ phone, apikey }) => {
      const url =
        `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
        `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
      try {
        const res = await fetch(url);
        // CallMeBot répond en texte : on l'affiche pour diagnostiquer (clé invalide, etc.)
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

// Encart "avis Google" — masqué si aucun lien (marques sans fiche Google).
function googleBox() {
  if (!BRAND_GOOGLE_REVIEW) return "";
  return (
    `<tr><td style="padding:0 28px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;"><tr><td align="center" style="padding:14px;">` +
    `<div style="font-size:15px;color:#0F2830;">&#11088;&#11088;&#11088;&#11088;&#11088; <b>5,0</b> &middot; 232 avis Google</div>` +
    `<a href="${BRAND_GOOGLE_REVIEW}" style="display:inline-block;margin-top:6px;font-size:13px;color:#F4631F;text-decoration:none;font-weight:bold;">Voir nos avis Google &rarr;</a>` +
    `</td></tr></table></td></tr>`
  );
}

function emailShell(inner) {
  const phoneHref = telHref(BRAND_PHONE);
  return (
    `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#eef2f2;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f2;padding:24px 0;"><tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">` +
    `<tr><td align="center" style="padding:22px 20px 14px;"><img src="${BRAND_LOGO}" alt="${esc(BRAND_NAME)}" width="160" style="display:block;height:auto;max-width:160px;"></td></tr>` +
    `<tr><td><img src="${brandPhoto()}" alt="Rider en eFoil" width="600" style="display:block;width:100%;height:auto;"></td></tr>` +
    inner +
    `<tr><td align="center" style="padding:16px 24px;background:#0F2830;color:#bfe3ea;font-size:12px;line-height:1.6;">${esc(BRAND_NAME)} — ${esc(BRAND_FOOTER)} &middot; <a href="tel:${phoneHref}" style="color:#bfe3ea;">${esc(BRAND_PHONE)}</a></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

// E-mail de RÉCEPTION envoyé AU CLIENT (sur r.email)
function clientEmailHtml(r) {
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
    googleBox();
  return emailShell(inner);
}

// E-mail de NOTIFICATION envoyé AU GÉRANT (sur OWNER_EMAIL)
function ownerEmailHtml(r) {
  const row = (k, v) =>
    `<tr><td style="padding:7px 14px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;font-size:13px;width:38%;">${k}</td><td style="padding:7px 14px;border:1px solid #e5e7eb;font-size:13px;">${esc(v) || "—"}</td></tr>`;
  const inner =
    `<tr><td style="padding:24px 28px 8px;color:#0F2830;">` +
    `<h1 style="margin:0 0 14px;font-size:21px;color:#F4631F;">&#128276; Nouvelle réservation</h1>` +
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
    googleBox();
  return emailShell(inner);
}

// E-mail de VALIDATION envoyé AU CLIENT quand le gérant confirme la réservation.
function confirmedEmailHtml(r) {
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
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;">Une question ou un imprévu ? Répondez à cet e-mail ou appelez le <a href="tel:${telHref(BRAND_PHONE)}" style="color:#F4631F;">${esc(BRAND_PHONE)}</a>.</p>` +
    `</td></tr>` +
    googleBox();
  return emailShell(inner);
}

// E-mail de PROPOSITION d'un autre créneau, envoyé au client. p = { date, slot, message }
function proposalEmailHtml(r, p) {
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
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;">Ce créneau vous convient ? Répondez à cet e-mail ou appelez le <a href="tel:${telHref(BRAND_PHONE)}" style="color:#F4631F;">${esc(BRAND_PHONE)}</a>.</p>` +
    `</td></tr>` +
    googleBox();
  return emailShell(inner);
}

// E-mail d'ANNULATION envoyé au client quand le gérant annule la réservation.
function cancelEmailHtml(r) {
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
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;">Répondez à cet e-mail ou appelez le <a href="tel:${telHref(BRAND_PHONE)}" style="color:#F4631F;">${esc(BRAND_PHONE)}</a>.</p>` +
    `</td></tr>` +
    googleBox();
  return emailShell(inner);
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

function senderFrom() {
  return `"${BRAND_NAME}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`;
}

// Copie cachée : BCC_ALL = archive globale (reçoit TOUT, y compris les mails clients).
// includeOwner = ajoute aussi OWNER_EMAIL (le gérant garde une trace de SES mails clients).
function bccFor(includeOwner) {
  const list = [];
  if (includeOwner && process.env.OWNER_EMAIL) list.push(process.env.OWNER_EMAIL);
  if (process.env.BCC_ALL) list.push(process.env.BCC_ALL);
  return list.length ? list.join(", ") : undefined;
}

async function sendEmails(r) {
  const transport = await makeTransport();
  if (!transport) {
    console.warn(
      "[notify] SMTP non configuré (SMTP_HOST / SMTP_USER / SMTP_PASS manquant) — e-mail ignoré"
    );
    return;
  }
  try {
    const from = senderFrom();
    const jobs = [];
    if (process.env.OWNER_EMAIL) {
      jobs.push({
        label: "gérant",
        p: transport.sendMail({
          from,
          to: process.env.OWNER_EMAIL, // peut contenir plusieurs adresses séparées par virgule
          bcc: bccFor(false), // archive globale (BCC_ALL) ; le gérant est déjà en "to"
          replyTo: r.email || process.env.EMAIL_REPLY_TO, // répondre = écrire au client
          subject: `Nouvelle réservation — ${r.name} (${r.date} ${r.slot})`,
          html: ownerEmailHtml(r),
        }),
      });
    }
    if (r.email) {
      jobs.push({
        label: "client",
        p: transport.sendMail({
          from,
          to: r.email,
          bcc: bccFor(false), // archive globale ; le gérant a déjà reçu sa notif dédiée
          replyTo: process.env.EMAIL_REPLY_TO || undefined,
          subject: `Votre réservation ${BRAND_NAME} — ${r.ref}`,
          html: clientEmailHtml(r),
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
  await Promise.allSettled([sendWhatsApp(reservation), sendEmails(reservation)]);
}

// Envoi ponctuel : e-mail de VALIDATION au client (déclenché depuis le dashboard).
export async function sendConfirmation(r) {
  if (!r?.email) return { ok: false, error: "réservation sans e-mail client" };
  const transport = await makeTransport();
  if (!transport) return { ok: false, error: "SMTP non configuré" };
  try {
    await transport.sendMail({
      from: senderFrom(),
      to: r.email,
      bcc: bccFor(true), // gérant (trace) + archive globale
      replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || process.env.SMTP_USER,
      subject: `Réservation confirmée — ${BRAND_NAME} (${r.ref})`,
      html: confirmedEmailHtml(r),
    });
    console.log(`[notify] e-mail validation client OK (${r.ref})`);
    return { ok: true };
  } catch (e) {
    console.error("[notify] e-mail validation ÉCHEC :", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// Envoi ponctuel : e-mail de PROPOSITION d'un autre créneau au client.
export async function sendProposal(r, p) {
  if (!r?.email) return { ok: false, error: "réservation sans e-mail client" };
  if (!p?.date || !p?.slot) return { ok: false, error: "créneau proposé manquant" };
  const transport = await makeTransport();
  if (!transport) return { ok: false, error: "SMTP non configuré" };
  try {
    await transport.sendMail({
      from: senderFrom(),
      to: r.email,
      bcc: bccFor(true),
      replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || process.env.SMTP_USER,
      subject: `Proposition de créneau — ${BRAND_NAME} (${r.ref})`,
      html: proposalEmailHtml(r, p),
    });
    console.log(`[notify] e-mail proposition client OK (${r.ref})`);
    return { ok: true };
  } catch (e) {
    console.error("[notify] e-mail proposition ÉCHEC :", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// Envoi ponctuel : e-mail d'ANNULATION au client.
export async function sendCancellation(r) {
  if (!r?.email) return { ok: false, error: "réservation sans e-mail client" };
  const transport = await makeTransport();
  if (!transport) return { ok: false, error: "SMTP non configuré" };
  try {
    await transport.sendMail({
      from: senderFrom(),
      to: r.email,
      bcc: bccFor(true),
      replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || process.env.SMTP_USER,
      subject: `Réservation annulée — ${BRAND_NAME} (${r.ref})`,
      html: cancelEmailHtml(r),
    });
    console.log(`[notify] e-mail annulation client OK (${r.ref})`);
    return { ok: true };
  } catch (e) {
    console.error("[notify] e-mail annulation ÉCHEC :", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
