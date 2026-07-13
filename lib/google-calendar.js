// Écrit un événement dans le Google Agenda partagé à chaque réservation CONFIRMÉE.
// Auth = COMPTE DE SERVICE Google (headless), SANS dépendance npm (pas de `googleapis`) :
//   1. on signe nous-mêmes un JWT (RS256) avec la clé privée du compte de service,
//   2. on l'échange contre un access_token OAuth2,
//   3. on appelle l'API REST Calendar via fetch.
// Tout est OPTIONNEL et tolérant aux pannes : si les vars d'env manquent
// (GOOGLE_SA_KEY_BASE64 + GOOGLE_CALENDAR_ID), on ne fait rien et on n'échoue JAMAIS
// la confirmation (même philosophie que notify.js). Les secrets restent en variables
// d'environnement (Coolify) — rien n'est committé (repo public).
import crypto from "node:crypto";
import { brandFor } from "./sites";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const API = "https://www.googleapis.com/calendar/v3";

// ---------- Configuration (lue au runtime) ----------

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || "";
}

// Compte de service : soit le JSON en base64 (GOOGLE_SA_KEY_BASE64), soit le JSON brut
// (GOOGLE_SA_KEY). Renvoie l'objet { client_email, private_key, ... } ou null.
function serviceAccount() {
  const b64 = process.env.GOOGLE_SA_KEY_BASE64;
  const raw = process.env.GOOGLE_SA_KEY;
  let json = "";
  if (b64) json = Buffer.from(b64, "base64").toString("utf8");
  else if (raw) json = raw;
  if (!json) return null;
  try {
    const sa = JSON.parse(json);
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    return null;
  }
}

export function calendarConfigured() {
  return !!(calendarId() && serviceAccount());
}

// ---------- Auth : JWT signé -> access_token (mis en cache le temps de sa validité) ----------

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

let tokenCache = { token: "", exp: 0 };

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 30 > now) return tokenCache.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(sa.private_key);
  const jwt = `${signingInput}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth ${res.status} : ${data.error_description || data.error || "token refusé"}`);
  }
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

// ---------- Construction de l'événement à partir d'une réservation ----------

// ID d'événement DÉTERMINISTE dérivé de la ref -> idempotent (re-run = mise à jour, pas de doublon).
// Contrainte Google : caractères base32hex [a-v0-9], 5..1024 car. Un hash hex respecte ça.
function eventId(ref) {
  return crypto.createHash("sha256").update(String(ref)).digest("hex"); // 64 car. hex
}

// "10:00" / "10h" / "9h30" -> { h, m } ; sinon null (=> événement toute la journée).
function parseSlot(slot) {
  const m = String(slot || "").match(/(\d{1,2})\s*[:hH]\s*(\d{2})?/);
  if (!m) return null;
  const h = Math.min(23, parseInt(m[1], 10) || 0);
  const min = Math.min(59, parseInt(m[2] || "0", 10) || 0);
  return { h, m: min };
}

// Durée en minutes déduite de la formule ("Initiation 1h", "Session 2h", "1h30") ; défaut 60.
function durationMinutes(formule) {
  const m = String(formule || "").match(/(\d+)\s*h(?:\s*(\d{2}))?/i);
  if (!m) return 60;
  return (parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2] || "0", 10) || 0) || 60;
}

// Ajoute n jours à une date "YYYY-MM-DD" (arithmétique en UTC, sans souci de fuseau/DST).
function addDays(dateStr, n) {
  if (!n) return dateStr;
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// date + slot + durée -> { startLocal, endLocal } 'YYYY-MM-DDTHH:mm:ss' (heure de Paris, SANS 'Z')
// ou null si le créneau n'a pas d'heure exploitable (=> événement journée entière).
function localRange(date, slot, minutes) {
  const t = parseSlot(slot);
  if (!t) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const startTotal = t.h * 60 + t.m;
  const endTotal = startTotal + minutes;
  const startLocal = `${date}T${pad(t.h)}:${pad(t.m)}:00`;
  const endDate = addDays(date, Math.floor(endTotal / 1440));
  const endMin = endTotal % 1440;
  const endLocal = `${endDate}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`;
  return { startLocal, endLocal };
}

// Couleur (colorId Google 1..11) + libellé selon le STATUT de la réservation.
// Défaut : en attente = 6 (orange), confirmée = 10 (vert), proposé = 9 (bleu).
// GOOGLE_EVENT_COLOR_ID, si défini, FORCE une couleur unique pour tout.
const STATUS_COLOR = { pending: "6", confirmed: "10", proposed: "9" };
const STATUS_LABEL = { pending: "En attente", confirmed: "Confirmé", proposed: "Créneau proposé" };
function eventColorId(status) {
  const forced = process.env.GOOGLE_EVENT_COLOR_ID;
  if (forced && forced.trim()) return forced.trim();
  return STATUS_COLOR[status] || "";
}

// " le 09/07/2026 11:20" (heure de Paris) ou "" si l'horodatage manque/est illisible.
function paidWhen(r) {
  if (!r?.paidAt) return "";
  try {
    return (
      " le " +
      new Date(r.paidAt).toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
        dateStyle: "short",
        timeStyle: "short",
      })
    );
  } catch {
    return "";
  }
}

// Corps de l'événement Calendar. On NE met PAS d'invités (attendees) : sur un compte
// Gmail perso, un compte de service ne peut pas inviter -> tout dans la description.
function eventBody(r) {
  const b = brandFor(r.siteId);
  const status = r.status || "pending";
  // Pour un créneau PROPOSÉ, on affiche le créneau qu'on propose au client.
  const eDate = status === "proposed" && r.proposedDate ? r.proposedDate : r.date;
  const eSlot = status === "proposed" && r.proposedSlot ? r.proposedSlot : r.slot;
  const minutes = durationMinutes(r.formule);
  const range = localRange(eDate, eSlot, minutes);
  const description = [
    `Statut : ${STATUS_LABEL[status] || status}`,
    `Acompte : ${r.paid ? `💶 PAYÉ${paidWhen(r)}` : "en attente de paiement"}`,
    `Client : ${r.name || "—"}`,
    `Téléphone : ${r.phone || "—"}`,
    `E-mail : ${r.email || "—"}`,
    `Formule : ${r.formule || "—"}`,
    `Participants : ${r.participants ?? "—"}${r.level ? ` (niveau ${r.level})` : ""}`,
    r.message ? `Message : ${r.message}` : "",
    `Référence : ${r.ref}`,
    `Site : ${b.name}`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    // status:confirmed (event Google) -> un PUT "réveille" un event annulé (revive tombstone).
    // Le statut de la RÉSA est porté par la COULEUR + le libellé du titre, pas par ce champ.
    status: "confirmed",
    // Le titre porte le paiement en tête : visible d'un coup d'œil dans la grille de l'agenda.
    summary: `${r.paid ? "💶 PAYÉ · " : ""}${STATUS_LABEL[status] || status} — eFoil ${r.name || "Réservation"} (${r.participants || 1}p)`,
    description,
    location: b.footer || b.name || "",
  };
  const color = eventColorId(status);
  if (color) body.colorId = color;
  if (range) {
    body.start = { dateTime: range.startLocal, timeZone: "Europe/Paris" };
    body.end = { dateTime: range.endLocal, timeZone: "Europe/Paris" };
  } else {
    body.start = { date: eDate };
    body.end = { date: addDays(eDate, 1) };
  }
  return body;
}

// ---------- Appels API ----------

async function apiFetch(token, method, path, body) {
  return fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Crée OU met à jour l'événement d'une réservation (idempotent via l'id déterministe).
// Ne jette jamais : renvoie { ok, id?, htmlLink? } ou { ok:false, skipped/error }.
export async function upsertReservationEvent(r) {
  const sa = serviceAccount();
  const cal = calendarId();
  if (!sa || !cal) {
    console.warn("[agenda] non configuré (GOOGLE_SA_KEY_BASE64 / GOOGLE_CALENDAR_ID) — ignoré");
    return { ok: false, skipped: true };
  }
  try {
    const token = await getAccessToken(sa);
    const id = eventId(r.ref);
    const body = eventBody(r);
    const calPath = encodeURIComponent(cal);

    // On tente d'abord une MISE À JOUR (PUT idempotent sur notre id déterministe)...
    let res = await apiFetch(token, "PUT", `/calendars/${calPath}/events/${id}`, body);
    // ...si l'événement n'existe pas encore, on l'INSÈRE avec notre id.
    if (res.status === 404 || res.status === 410) {
      res = await apiFetch(token, "POST", `/calendars/${calPath}/events`, { ...body, id });
      // 409 = id déjà réservé par un event annulé (résa annulée puis re-confirmée).
      // On "réveille" l'event via un PUT (status:confirmed déjà dans body) au lieu d'échouer.
      if (res.status === 409) {
        res = await apiFetch(token, "PUT", `/calendars/${calPath}/events/${id}`, body);
      }
    }
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Calendar ${res.status} : ${err.slice(0, 200)}`);
    }
    const ev = await res.json().catch(() => ({}));
    console.log(`[agenda] événement OK (${r.ref}) -> ${ev.htmlLink || ev.id || id}`);
    return { ok: true, id: ev.id || id, htmlLink: ev.htmlLink || "" };
  } catch (e) {
    console.error(`[agenda] échec upsert (${r?.ref}) :`, e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// Supprime l'événement d'une réservation (annulation / suppression). Ne jette jamais.
export async function deleteReservationEvent(ref) {
  const sa = serviceAccount();
  const cal = calendarId();
  if (!sa || !cal) return { ok: false, skipped: true };
  try {
    const token = await getAccessToken(sa);
    const id = eventId(ref);
    const res = await apiFetch(token, "DELETE", `/calendars/${encodeURIComponent(cal)}/events/${id}`);
    // 200/204 = supprimé ; 404/410 = déjà absent -> on considère OK.
    if (res.ok || res.status === 404 || res.status === 410) {
      console.log(`[agenda] événement supprimé (${ref})`);
      return { ok: true };
    }
    const err = await res.text().catch(() => "");
    throw new Error(`Calendar ${res.status} : ${err.slice(0, 200)}`);
  } catch (e) {
    console.error(`[agenda] échec suppression (${ref}) :`, e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
