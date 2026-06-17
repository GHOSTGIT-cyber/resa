// Stockage des réservations en fichier JSON (zéro dépendance native).
// Volume Coolify recommandé : monter un volume persistant sur /app/data.
// Pour de gros volumes, remplacer par Postgres (voir CLAUDE-HANDOFF.md).
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "reservations.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]", "utf8");
}

export function readAll() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) || [];
  } catch {
    return [];
  }
}

export function add(reservation) {
  ensure();
  const all = readAll();
  all.push(reservation);
  // écriture atomique : fichier temporaire puis rename
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
  return reservation;
}

// Agrégats publics (sans données personnelles) : nb réservations,
// nb total de participants, répartition par créneau / date / formule.
export function stats(all) {
  const bySlot = {};
  const byDate = {};
  const byFormule = {};
  let participants = 0;
  for (const r of all) {
    const p = Number(r.participants) || 0;
    participants += p;
    if (r.slot) bySlot[r.slot] = (bySlot[r.slot] || 0) + p;
    if (r.date) byDate[r.date] = (byDate[r.date] || 0) + p;
    if (r.formule) byFormule[r.formule] = (byFormule[r.formule] || 0) + 1;
  }
  return {
    totalReservations: all.length,
    totalParticipants: participants,
    bySlot,
    byDate,
    byFormule,
  };
}
