// Notifications serveur déclenchées à chaque nouvelle réservation.
// Deux canaux, tous deux OPTIONNELS et tolérants aux pannes :
//   - WhatsApp via CallMeBot (jusqu'à 3 destinataires, chacun sa clé apikey)
//   - E-mail via SMTP (nodemailer) : 1 mail gérant + 1 mail de confirmation client
// Aucun canal ne fait jamais échouer la requête (Promise.allSettled partout).

function dashboardUrl() {
  return process.env.DASHBOARD_URL || "https://resa.bakabi.fr";
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
    "Nouvelle reservation eFoil",
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
  if (!recips.length) return;
  const text = waText(r);
  await Promise.allSettled(
    recips.map(({ phone, apikey }) => {
      const url =
        `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
        `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
      return fetch(url);
    })
  );
}

// ---------- E-mail (SMTP via nodemailer) ----------

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// --- Templates HTML (fournis par le « Claude SITE », identité de marque eFoil) ---
const SITE = "https://efoilcotedazur.fr";
const LOGO = SITE + "/wp-content/uploads/2026/06/efca-logo.webp";
const PHOTO = SITE + "/wp-content/uploads/2026/06/efca-cdz-10.webp";
const GOOGLE = "https://maps.app.goo.gl/SmZHJVCmXBzgBV7b9";

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

const GOOGLE_BOX =
  `<tr><td style="padding:0 28px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;"><tr><td align="center" style="padding:14px;">` +
  `<div style="font-size:15px;color:#0F2830;">&#11088;&#11088;&#11088;&#11088;&#11088; <b>5,0</b> &middot; 232 avis Google</div>` +
  `<a href="${GOOGLE}" style="display:inline-block;margin-top:6px;font-size:13px;color:#F4631F;text-decoration:none;font-weight:bold;">Voir nos avis Google &rarr;</a>` +
  `</td></tr></table></td></tr>`;

function emailShell(inner) {
  return (
    `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#eef2f2;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f2;padding:24px 0;"><tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">` +
    `<tr><td align="center" style="padding:22px 20px 14px;"><img src="${LOGO}" alt="eFoil Côte d'Azur" width="160" style="display:block;height:auto;max-width:160px;"></td></tr>` +
    `<tr><td><img src="${PHOTO}" alt="Rider en eFoil — eFoil Côte d'Azur" width="600" style="display:block;width:100%;height:auto;"></td></tr>` +
    inner +
    `<tr><td align="center" style="padding:16px 24px;background:#0F2830;color:#bfe3ea;font-size:12px;line-height:1.6;">eFoil Côte d'Azur — Mandelieu-la-Napoule &amp; baie de Cannes &middot; <a href="tel:+33635305067" style="color:#bfe3ea;">06 35 30 50 67</a></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

// E-mail de CONFIRMATION envoyé AU CLIENT (sur r.email)
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
    GOOGLE_BOX;
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
    GOOGLE_BOX;
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
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;">Une question ou un imprévu ? Répondez à cet e-mail ou appelez le <a href="tel:+33635305067" style="color:#F4631F;">06 35 30 50 67</a>.</p>` +
    `</td></tr>` +
    GOOGLE_BOX;
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
    // évite que la requête traîne si le serveur SMTP ne répond pas
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// Expéditeur affiché. Par défaut = compte SMTP. EMAIL_FROM permet d'afficher une autre
// adresse (ex. via Brevo/Mailgun où l'utilisateur SMTP n'est pas l'adresse d'envoi).
function senderFrom() {
  return `"eFoil Côte d'Azur" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`;
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
          replyTo: process.env.EMAIL_REPLY_TO || undefined, // boîte surveillée si définie
          subject: `Votre réservation eFoil Côte d'Azur — ${r.ref}`,
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
// Renvoie { ok, error? } pour afficher un retour clair côté UI.
export async function sendConfirmation(r) {
  if (!r?.email) return { ok: false, error: "réservation sans e-mail client" };
  const transport = await makeTransport();
  if (!transport) return { ok: false, error: "SMTP non configuré" };
  try {
    await transport.sendMail({
      from: senderFrom(),
      to: r.email,
      replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || process.env.SMTP_USER,
      subject: `Réservation confirmée — eFoil Côte d'Azur (${r.ref})`,
      html: confirmedEmailHtml(r),
    });
    console.log(`[notify] e-mail validation client OK (${r.ref})`);
    return { ok: true };
  } catch (e) {
    console.error("[notify] e-mail validation ÉCHEC :", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
