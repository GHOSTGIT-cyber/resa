// Intégration SumUp (OAuth 2.0 + Hosted Checkout) — auto « Payé ».
// Flux : Nico autorise l'app (OAuth) -> on stocke un jeton (fichier volume) ->
// à la demande de paiement on crée un Hosted Checkout (page SumUp) référencé par la
// réservation -> au retour/webhook on vérifie le statut et on passe la résa en "payé".
// Tout est OPTIONNEL et gated : sans SUMUP_CLIENT_ID/SECRET ni jeton, rien ne se passe.
import fs from "node:fs";
import path from "node:path";
import { actionToken } from "./links";
import { update, readAll } from "./store";

const AUTH_URL = "https://api.sumup.com/authorize";
const TOKEN_URL = "https://api.sumup.com/token";
const API = "https://api.sumup.com/v0.1";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const TOKEN_FILE = path.join(DATA_DIR, "sumup-token.json");

// ---------- Config ----------
function clientId() {
  return process.env.SUMUP_CLIENT_ID || "";
}
function clientSecret() {
  return process.env.SUMUP_CLIENT_SECRET || "";
}
function scopes() {
  return process.env.SUMUP_SCOPES || "payments transactions.history user.profile_readonly";
}
function currency() {
  return process.env.SUMUP_CURRENCY || "EUR";
}
function amountValue() {
  const n = parseFloat(String(process.env.SUMUP_AMOUNT || "50").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : 50;
}
function dashboardUrl() {
  return process.env.DASHBOARD_URL || "https://resa.efoilcotedazur.fr";
}
function redirectUri() {
  return dashboardUrl() + "/api/sumup/callback";
}

export function sumupOAuthConfigured() {
  return !!(clientId() && clientSecret());
}

// ---------- Stockage du jeton ----------
function readToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}
function writeToken(tok) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = TOKEN_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(tok, null, 2), "utf8");
    fs.renameSync(tmp, TOKEN_FILE);
  } catch (e) {
    console.error("[sumup] écriture jeton échec :", e?.message || e);
  }
}
export function sumupConnected() {
  return !!readToken()?.refresh_token;
}
export function sumupReady() {
  return sumupOAuthConfigured() && sumupConnected();
}

// ---------- État OAuth (CSRF) signé, sans stockage ----------
export function makeState() {
  const ts = Date.now();
  return `${ts}.${actionToken(String(ts), "sumup-state")}`;
}
export function verifyState(state) {
  const [ts, sig] = String(state || "").split(".");
  if (!ts || !sig) return false;
  if (actionToken(ts, "sumup-state") !== sig) return false;
  return Date.now() - Number(ts) < 15 * 60 * 1000;
}

export function authorizeUrl(state) {
  // IMPORTANT : espaces des scopes en %20, PAS "+". URLSearchParams met "+" et SumUp
  // le lit littéralement -> "This application is misconfigured". On encode à la main.
  const q =
    "response_type=code" +
    "&client_id=" + encodeURIComponent(clientId()) +
    "&redirect_uri=" + encodeURIComponent(redirectUri()) +
    "&scope=" + encodeURIComponent(scopes()) +
    "&state=" + encodeURIComponent(state);
  return `${AUTH_URL}?${q}`;
}

// ---------- Jetons OAuth ----------
async function fetchMerchantCode(accessToken) {
  try {
    const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const d = await res.json().catch(() => ({}));
    return (
      d?.merchant_profile?.merchant_code ||
      d?.merchant_code ||
      d?.account?.merchant_code ||
      ""
    );
  } catch {
    return "";
  }
}

// Échange le code d'autorisation contre un jeton (appelé par le callback).
export async function exchangeCode(code) {
  if (!sumupOAuthConfigured()) return { ok: false, error: "SUMUP_CLIENT_ID/SECRET manquants" };
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        client_id: clientId(),
        client_secret: clientSecret(),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) {
      return { ok: false, error: `token ${res.status} ${d.error_description || d.error || ""}` };
    }
    const merchant_code = await fetchMerchantCode(d.access_token);
    writeToken({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Date.now() + (d.expires_in || 3600) * 1000,
      merchant_code,
    });
    console.log(`[sumup] compte lié (merchant ${merchant_code || "?"})`);
    return { ok: true, merchant_code };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function getAccessToken() {
  const tok = readToken();
  if (!tok?.refresh_token) return null;
  if (tok.access_token && tok.expires_at - 60000 > Date.now()) return tok.access_token;
  // refresh
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tok.refresh_token,
        client_id: clientId(),
        client_secret: clientSecret(),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) throw new Error(`refresh ${res.status} ${d.error || ""}`);
    writeToken({
      access_token: d.access_token,
      refresh_token: d.refresh_token || tok.refresh_token,
      expires_at: Date.now() + (d.expires_in || 3600) * 1000,
      merchant_code: tok.merchant_code,
    });
    return d.access_token;
  } catch (e) {
    console.error("[sumup] refresh échec :", e?.message || e);
    return null;
  }
}

// ---------- Paiement ----------
// Lien signé de la page /pay (créée le checkout au clic → redirige vers SumUp).
export function payUrl(ref) {
  return `${dashboardUrl()}/pay?ref=${encodeURIComponent(ref)}&t=${actionToken(ref, "pay")}`;
}

// Crée un Hosted Checkout pour une réservation. Renvoie { ok, url } ou { ok:false, error }.
export async function createHostedCheckout(r) {
  if (!sumupReady()) return { ok: false, error: "SumUp non connecté" };
  const token = await getAccessToken();
  const merchant = readToken()?.merchant_code;
  if (!token || !merchant) return { ok: false, error: "jeton/merchant indisponible" };
  try {
    const res = await fetch(`${API}/checkouts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        checkout_reference: `${r.ref}-${Date.now().toString(36)}`,
        amount: amountValue(),
        currency: currency(),
        merchant_code: merchant,
        description: `Acompte eFoil — ${r.ref}`,
        hosted_checkout: { enabled: true },
        // redirect_url : où le NAVIGATEUR du client atterrit après paiement.
        redirect_url: `${dashboardUrl()}/api/sumup/return?ref=${encodeURIComponent(r.ref)}`,
        // return_url : callback SERVEUR À SERVEUR. INDISPENSABLE : si le client paie puis
        // ferme son onglet, il n'y a pas de retour navigateur — sans ce webhook le paiement
        // ne serait JAMAIS détecté (résa jamais marquée payée, aucun mail au client).
        return_url: `${dashboardUrl()}/api/sumup/webhook`,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.hosted_checkout_url) {
      return { ok: false, error: `checkout ${res.status} ${JSON.stringify(d).slice(0, 160)}` };
    }
    update(r.ref, { sumupCheckoutId: d.id });
    return { ok: true, url: d.hosted_checkout_url };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Interroge l'API SumUp (source de vérité) : ce checkout est-il payé ? { paid, status }.
// N'ÉCRIT RIEN : c'est l'appelant qui déclenche markPaid() (lib/paid.js), lequel envoie
// aussi le mail au client et met l'agenda à jour. On garde ce module sans dépendance à
// notify/agenda (sinon import circulaire notify -> sumup -> paid -> notify).
export async function checkPaymentStatus(ref) {
  const r = readAll().find((x) => x.ref === ref);
  if (!r?.sumupCheckoutId) return { paid: false };
  const token = await getAccessToken();
  if (!token) return { paid: false };
  try {
    const res = await fetch(`${API}/checkouts/${encodeURIComponent(r.sumupCheckoutId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json().catch(() => ({}));
    const status = String(d.status || "").toUpperCase();
    if (status === "PAID") {
      console.log(`[sumup] paiement confirmé (${ref})`);
      return { paid: true };
    }
    return { paid: false, status };
  } catch (e) {
    console.error(`[sumup] check statut échec (${ref}) :`, e?.message || e);
    return { paid: false };
  }
}

// Retrouve la réservation liée à un id de checkout (pour le webhook).
export function refByCheckoutId(id) {
  if (!id) return "";
  const r = readAll().find((x) => x.sumupCheckoutId === id);
  return r?.ref || "";
}

// ---------- Réconciliation / diagnostic ----------
// Le jeton MARCHAND (autorisé par Nico) fonctionne-t-il encore ? S'il est cassé, AUCUN
// paiement ne remonte automatiquement — tout retombe en manuel sans prévenir. C'est LE
// point à vérifier quand on doute d'un paiement. { configured, connected, works, merchant }.
export async function tokenHealth() {
  const configured = sumupOAuthConfigured();
  const connected = sumupConnected();
  let works = false;
  if (configured && connected) works = !!(await getAccessToken());
  return { configured, connected, works, merchant: readToken()?.merchant_code || "" };
}

// Liste les transactions RÉELLES encaissées sur le compte SumUp — la seule source de vérité
// pour savoir ce qui a été payé (indépendamment de nos checkouts). Nécessite le scope
// transactions.history (accordé lors de l'autorisation). { ok, items } ou { ok:false, error }.
export async function listTransactions(limit = 40) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "jeton SumUp indisponible (compte non connecté ou expiré)" };
  try {
    const res = await fetch(
      `${API}/me/transactions/history?limit=${encodeURIComponent(limit)}&order=descending`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `SumUp ${res.status} ${JSON.stringify(d).slice(0, 160)}` };
    return { ok: true, items: d.items || (Array.isArray(d) ? d : []) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
