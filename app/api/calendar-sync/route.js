// Synchronisation MANUELLE de l'agenda : pousse toutes les réservations NON ANNULÉES
// (en attente / confirmée / proposé), colorées par statut, dans le Google Agenda.
// Déclenché par le bouton « Synchroniser l'agenda » du dashboard. Idempotent (id d'event
// déterministe → pas de doublon), best-effort, réservé aux sites gérés par ce déploiement.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readAll } from "../../../lib/store";
import { COOKIE, isAuthed } from "../../../lib/auth";
import { enabledSiteIds, defaultSiteId } from "../../../lib/sites";
import { upsertReservationEvent, calendarConfigured } from "../../../lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isAuthed(cookies().get(COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "non autorisé" }, { status: 401 });
  }
  if (!calendarConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Agenda non configuré (GOOGLE_CALENDAR_ID / GOOGLE_SA_KEY_BASE64 manquants)" },
      { status: 400 }
    );
  }
  const enabled = enabledSiteIds();
  // Toutes les résa NON annulées (en attente / confirmée / proposé), colorées par statut.
  const toSync = readAll().filter(
    (r) => (r.status || "pending") !== "cancelled" && enabled.includes(r.siteId || defaultSiteId())
  );

  let synced = 0;
  let failed = 0;
  for (const r of toSync) {
    const res = await upsertReservationEvent(r).catch(() => ({ ok: false }));
    if (res && res.ok) synced++;
    else failed++;
  }
  return NextResponse.json({ ok: true, total: toSync.length, synced, failed });
}
