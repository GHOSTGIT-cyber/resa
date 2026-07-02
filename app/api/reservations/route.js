import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readAll, add, remove, setStatus, update, stats, STATUSES } from "../../../lib/store";
import { COOKIE, isAuthed } from "../../../lib/auth";
import { notify, sendConfirmation, sendProposal, sendCancellation } from "../../../lib/notify";
import { resolveSite, enabledSites, enabledSiteIds, defaultSiteId } from "../../../lib/sites";
import { upsertReservationEvent, deleteReservationEvent } from "../../../lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function authed() {
  return isAuthed(cookies().get(COOKIE)?.value);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// ---- GET : alimente le dashboard ----
// Public  : stats + réservations SANS données perso (date, créneau, participants, formule, statut)
// Authentifié (cookie) : + nom, téléphone, e-mail, message
export async function GET() {
  const isAuth = authed();
  // Isolation : on ne lit QUE les réservations des sites gérés par ce déploiement.
  const enabled = enabledSiteIds();
  const all = readAll()
    .filter((r) => enabled.includes(r.siteId || defaultSiteId()))
    .sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const list = all.map((r) => {
    const base = {
      ref: r.ref,
      date: r.date,
      slot: r.slot,
      participants: r.participants,
      formule: r.formule,
      level: r.level,
      status: r.status || "pending",
      proposedDate: r.proposedDate || "",
      proposedSlot: r.proposedSlot || "",
      siteId: r.siteId || "",
      createdAt: r.createdAt,
    };
    if (isAuth) {
      return { ...base, name: r.name, phone: r.phone, email: r.email, message: r.message, paid: !!r.paid };
    }
    return base;
  });
  const sites = enabledSites();
  return NextResponse.json({
    authed: isAuth,
    brand: sites[0]?.name || "eFoil",
    sites,
    stats: stats(all),
    reservations: list,
  });
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
    status: "pending",
    // site verrouillé aux sites de ce déploiement (?site=... ou domaine d'arrivée)
    siteId: resolveSite(request.headers.get("host"), new URL(request.url).searchParams.get("site")),
    createdAt: new Date().toISOString(),
  };
  add(reservation);

  // notifications serveur (WhatsApp + e-mail) — n'échouent jamais la requête
  await notify(reservation).catch(() => {});

  return new NextResponse(JSON.stringify({ ok: true, ref: reservation.ref }), {
    status: 201,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---- PATCH : change le statut d'une réservation (authentifié) ----
// body { ref, status }  status ∈ pending | confirmed | cancelled
export async function PATCH(request) {
  if (!authed()) {
    return NextResponse.json({ ok: false, error: "non autorisé" }, { status: 401 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const ref = String(body.ref || "");

  // Bascule "payé" (manuel), indépendante du statut de réservation.
  if (typeof body.paid === "boolean") {
    if (!ref) return NextResponse.json({ ok: false, error: "ref manquante" }, { status: 400 });
    const okPaid = update(ref, {
      paid: body.paid,
      paidAt: body.paid ? new Date().toISOString() : "",
    });
    return NextResponse.json({ ok: okPaid }, { status: okPaid ? 200 : 404 });
  }

  const status = String(body.status || "");
  if (!ref || !STATUSES.includes(status)) {
    return NextResponse.json({ ok: false, error: "paramètres invalides" }, { status: 400 });
  }
  const ok = setStatus(ref, status);

  let emailed = null;
  if (ok && body.proposal) {
    // Proposition d'un autre créneau : on stocke le créneau proposé + on envoie le mail.
    update(ref, {
      proposedDate: String(body.proposal.date || ""),
      proposedSlot: String(body.proposal.slot || ""),
    });
    const r = readAll().find((x) => x.ref === ref);
    if (r) emailed = await sendProposal(r, body.proposal);
  } else if (ok && body.notify && status === "confirmed") {
    // Validation : mail de confirmation au client, avec ou sans lien de paiement.
    const r = readAll().find((x) => x.ref === ref);
    if (r) emailed = await sendConfirmation(r, { withPayment: !!body.payment });
  } else if (ok && body.notify && status === "cancelled") {
    // Annulation : on envoie le mail d'annulation au client.
    const r = readAll().find((x) => x.ref === ref);
    if (r) emailed = await sendCancellation(r);
  }

  // Agenda Google (best-effort) : event créé/màj à la confirmation, retiré à l'annulation.
  if (ok && status === "confirmed") {
    const rc = readAll().find((x) => x.ref === ref);
    if (rc) await upsertReservationEvent(rc).catch(() => {});
  } else if (ok && status === "cancelled") {
    await deleteReservationEvent(ref).catch(() => {});
  }

  return NextResponse.json({ ok, emailed }, { status: ok ? 200 : 404 });
}

// ---- DELETE : suppression DÉFINITIVE (authentifié) ----
// ?ref=...  — n'est exposé par l'UI qu'après annulation préalable.
export async function DELETE(request) {
  if (!authed()) {
    return NextResponse.json({ ok: false, error: "non autorisé" }, { status: 401 });
  }
  const ref = new URL(request.url).searchParams.get("ref");
  if (!ref) {
    return NextResponse.json({ ok: false, error: "ref manquante" }, { status: 400 });
  }
  const ok = remove(ref);
  if (ok) await deleteReservationEvent(ref).catch(() => {});
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
