import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readAll, add, stats } from "../../../lib/store";
import { COOKIE, isAuthed } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// ---- GET : alimente le dashboard ----
// Public  : stats + réservations SANS données perso (date, créneau, participants, formule)
// Authentifié (cookie) : + nom, téléphone, e-mail, message
export async function GET() {
  const authed = isAuthed(cookies().get(COOKIE)?.value);
  const all = readAll().sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const list = all.map((r) => {
    const base = {
      ref: r.ref,
      date: r.date,
      slot: r.slot,
      participants: r.participants,
      formule: r.formule,
      level: r.level,
      createdAt: r.createdAt,
    };
    if (authed) {
      return { ...base, name: r.name, phone: r.phone, email: r.email, message: r.message };
    }
    return base;
  });
  return NextResponse.json({ authed, stats: stats(all), reservations: list });
}

// ---- POST : enregistre une réservation (appelé par le formulaire du site) ----
// Accepte application/json OU text/plain (le formulaire poste en text/plain no-cors).
export async function POST(request) {
  let body = {};
  try {
    const raw = await request.text();
    body = JSON.parse(raw || "{}");
  } catch {
    return new NextResponse(JSON.stringify({ ok: false, error: "json invalide" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // anti-spam : honeypot rempli => on ignore silencieusement
  if (body.hp) {
    return new NextResponse(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }
  if (!body.name || !body.date || !body.slot) {
    return new NextResponse(JSON.stringify({ ok: false, error: "champs requis manquants" }), {
      status: 422,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const reservation = {
    ref: String(body.ref || "EFCA-" + Date.now()),
    name: String(body.name || "").slice(0, 120),
    email: String(body.email || "").slice(0, 160),
    phone: String(body.phone || "").slice(0, 40),
    formule: String(body.formule || "").slice(0, 120),
    date: String(body.date || "").slice(0, 20),
    slot: String(body.slot || "").slice(0, 20),
    participants: Math.max(1, Math.min(8, parseInt(body.participants, 10) || 1)),
    level: String(body.level || "").slice(0, 40),
    message: String(body.message || "").slice(0, 1000),
    createdAt: new Date().toISOString(),
  };
  add(reservation);

  // notification serveur OPTIONNELLE (WhatsApp via CallMeBot) si variables d'env définies
  await notifyWhatsApp(reservation).catch(() => {});

  return new NextResponse(JSON.stringify({ ok: true, ref: reservation.ref }), {
    status: 201,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function notifyWhatsApp(r) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_APIKEY;
  if (!phone || !apikey) return; // désactivé tant que non configuré
  const text =
    `Nouvelle réservation eFoil\n` +
    `Réf : ${r.ref}\nNom : ${r.name}\nTél : ${r.phone}\n` +
    `Formule : ${r.formule}\nDate : ${r.date} ${r.slot}\nParticipants : ${r.participants}`;
  const url =
    `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  await fetch(url);
}
