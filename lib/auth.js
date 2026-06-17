// Authentification simple par mot de passe pour dévoiler les données confidentielles.
// Mot de passe défini dans la variable d'env DASHBOARD_PASSWORD.
import crypto from "node:crypto";

export const COOKIE = "efca_dash";

function secret() {
  return process.env.DASHBOARD_SECRET || "change-me-secret";
}

// jeton déterministe stocké dans le cookie (ne révèle pas le mot de passe)
export function tokenFor(password) {
  return crypto.createHash("sha256").update(password + "|" + secret()).digest("hex");
}

export function expectedToken() {
  const pw = process.env.DASHBOARD_PASSWORD || "";
  return pw ? tokenFor(pw) : null;
}

export function checkPassword(password) {
  const pw = process.env.DASHBOARD_PASSWORD || "";
  return pw.length > 0 && password === pw;
}

export function isAuthed(cookieValue) {
  const exp = expectedToken();
  return !!exp && cookieValue === exp;
}
