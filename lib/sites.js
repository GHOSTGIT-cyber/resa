// Configuration des MARQUES (branding, NON secret) — partagée par tous les déploiements.
// Les secrets/destinataires (SMTP, OWNER_EMAIL, WHATSAPP_*, BCC_ALL, EMAIL_FROM/REPLY_TO)
// restent en VARIABLES D'ENVIRONNEMENT (différentes par déploiement).
//
// Un déploiement peut gérer 1 site (Côte d'Azur) OU plusieurs (Beauvallon + Croix-Valmer).
// Le site d'une réservation est déterminé par le DOMAINE d'arrivée (voir siteFromHost).

const CDA_LOGO = "https://efoilcotedazur.fr/wp-content/uploads/2026/06/efca-logo.webp";

export const SITES = {
  cotedazur: {
    name: "eFoil Côte d'Azur",
    site: "https://efoilcotedazur.fr",
    footer: "Mandelieu-la-Napoule & baie de Cannes",
    phone: "06 35 30 50 67",
    logo: CDA_LOGO,
    googleReview: "https://maps.app.goo.gl/SmZHJVCmXBzgBV7b9",
  },
  beauvallon: {
    name: "eFoil Beauvallon",
    site: "https://efoil-beauvallon.fr",
    footer: "Beauvallon",
    phone: "06 35 30 50 67",
    logo: CDA_LOGO,
    googleReview: "", // pas de fiche Google -> encart masqué
  },
  croixvalmer: {
    name: "eFoil Croix-Valmer",
    site: "https://efoil-croix-valmer.fr",
    footer: "La Croix-Valmer",
    phone: "06 35 30 50 67",
    logo: CDA_LOGO,
    googleReview: "",
  },
};

// Domaine (host) -> identifiant de site.
const DOMAIN_SITE = {
  "resa.efoilcotedazur.fr": "cotedazur",
  "resa.bakabi.fr": "cotedazur",
  "resa.efoil-beauvallon.fr": "beauvallon",
  "resa.efoil-croix-valmer.fr": "croixvalmer",
};

// Sites gérés par CE déploiement (pour afficher les boutons de filtre).
// SITES_ENABLED="beauvallon,croixvalmer" ; sinon SITE_ID ; sinon "cotedazur".
export function enabledSiteIds() {
  const raw = process.env.SITES_ENABLED || process.env.SITE_ID || "cotedazur";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => SITES[s]);
}

export function defaultSiteId() {
  if (process.env.SITE_ID && SITES[process.env.SITE_ID]) return process.env.SITE_ID;
  return enabledSiteIds()[0] || "cotedazur";
}

// Détermine le site d'une réservation à partir du host de la requête.
export function siteFromHost(host) {
  if (!host) return defaultSiteId();
  const h = String(host).toLowerCase().split(":")[0];
  return DOMAIN_SITE[h] || defaultSiteId();
}

// Résout le site d'une réservation entrante, VERROUILLÉ aux sites de ce déploiement.
// Priorité : ?site=... (formulaire) > domaine > défaut. Si le site demandé n'est pas
// autorisé ici, on retombe sur un site autorisé → impossible de stocker un site étranger.
export function resolveSite(host, siteParam) {
  const enabled = enabledSiteIds();
  if (siteParam && enabled.includes(siteParam)) return siteParam;
  const byHost = siteFromHost(host);
  if (enabled.includes(byHost)) return byHost;
  return enabled[0] || "cotedazur";
}

// Le site est-il géré par ce déploiement ? (isolation à la lecture)
export function siteAllowed(siteId) {
  return enabledSiteIds().includes(siteId);
}

// Branding d'un site (repli sur variables BRAND_* / défauts si site inconnu).
export function brandFor(siteId) {
  const s = SITES[siteId];
  if (s) return s;
  return {
    name: process.env.BRAND_NAME || "eFoil Côte d'Azur",
    site: process.env.BRAND_SITE || "https://efoilcotedazur.fr",
    footer: process.env.BRAND_FOOTER || "Mandelieu-la-Napoule & baie de Cannes",
    phone: process.env.BRAND_PHONE || "06 35 30 50 67",
    logo: process.env.BRAND_LOGO || CDA_LOGO,
    googleReview: process.env.BRAND_GOOGLE_REVIEW ?? "https://maps.app.goo.gl/SmZHJVCmXBzgBV7b9",
  };
}

// Liste { id, name } des sites gérés (pour le dashboard).
export function enabledSites() {
  return enabledSiteIds().map((id) => ({ id, name: SITES[id]?.name || id }));
}
