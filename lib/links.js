// Jetons signés pour les LIENS PUBLICS d'action sur une réservation
// (ex. bouton « Confirmer ma réservation » dans le mail de proposition).
// On réutilise DASHBOARD_SECRET : le jeton est un HMAC, donc INFALSIFIABLE
// sans le secret. Aucun stockage nécessaire, et c'est idempotent.
import crypto from "node:crypto";

function secret() {
  return process.env.DASHBOARD_SECRET || "change-me-secret";
}

// Jeton lié à (action, ref). 32 hex = largement suffisant, URL courte.
export function actionToken(ref, action) {
  return crypto
    .createHmac("sha256", secret())
    .update(String(action) + ":" + String(ref))
    .digest("hex")
    .slice(0, 32);
}

// Vérifie le jeton en temps constant (anti timing-attack).
export function verifyActionToken(ref, action, token) {
  if (!ref || !token) return false;
  const expected = actionToken(ref, action);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
