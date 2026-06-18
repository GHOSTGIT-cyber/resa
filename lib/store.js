// Stockage des réservations en fichier JSON (zéro dépendance native).
// Volume Coolify recommandé : monter un volume persistant sur /app/data.
// Pour de gros volumes, remplacer par Postgres (voir CLAUDE-HANDOFF.md).
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "reservations.json");

// Statuts possibles d'une réservation.
export const STATUSES = ["pending", "confirmed", "proposed", "cancelled"];

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

// Écriture atomique : fichier temporaire puis rename.
function writeAll(all) {
  ensure();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
}

export function add(reservation) {
  const all = readAll();
  all.push(reservation);
  writeAll(all);
  return reservation;
}

// Met à jour le statut d'une réservation. Renvoie true si trouvée.
export function setStatus(ref, status) {
  if (!STATUSES.includes(status)) return false;
  const all = readAll();
  const r = all.find((x) => x.ref === ref);
  if (!r) return false;
  r.status = status;
  writeAll(all);
  return true;
}

// Met à jour des champs arbitraires d'une réservation (ex. créneau proposé).
export function update(ref, patch) {
  const all = readAll();
  const r = all.find((x) => x.ref === ref);
  if (!r) return false;
  Object.assign(r, patch);
  writeAll(all);
  return true;
}

// Supprime DÉFINITIVEMENT une réservation. Renvoie true si trouvée.
// N'est appelé qu'après une annulation préalable (sécurité côté UI).
export function remove(ref) {
  const all = readAll();
  const next = all.filter((x) => x.ref !== ref);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

// Agrégats publics (sans données personnelles) : nb réservations,
// nb total de participants, répartition par créneau / date / formule.
// Les réservations annulées sont exclues des compteurs.
export function stats(all) {
  const active = all.filter((r) => r.status !== "cancelled");
  const bySlot = {};
  const byDate = {};
  const byFormule = {};
  let participants = 0;
  for (const r of active) {
    const p = Number(r.participants) || 0;
    participants += p;
    if (r.slot) bySlot[r.slot] = (bySlot[r.slot] || 0) + p;
    if (r.date) byDate[r.date] = (byDate[r.date] || 0) + p;
    if (r.formule) byFormule[r.formule] = (byFormule[r.formule] || 0) + 1;
  }
  return {
    totalReservations: active.length,
    totalParticipants: participants,
    bySlot,
    byDate,
    byFormule,
  };
}
