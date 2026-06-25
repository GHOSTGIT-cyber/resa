# Passation — Dashboard de réservation eFoil (repo `resa`)

> Pour la prochaine session Claude qui reprend ce projet. À jour au **2026-06-25**.
> ⚠️ **Repo PUBLIC** (`GHOSTGIT-cyber/resa`) : jamais de secret ni de PII client dans le code/les commits. Tout secret vit dans les variables Coolify.

## 1. C'est quoi
App **Next.js (App Router)** : reçoit les réservations envoyées par les sites vitrines et les affiche dans un **dashboard** (vue publique = nb personnes + créneaux ; **mot de passe** pour dévoiler nom/tél/e-mail). Déployée sur **Coolify** (serveur Hetzner `162.55.35.65`). Stockage = **fichier JSON** sur un **volume persistant `/app/data`** (un volume distinct par déploiement).

## 2. Architecture MULTI-SITES (le point clé)
Un **même dépôt** sert **plusieurs marques**. Un déploiement peut gérer 1 site (Côte d'Azur) ou plusieurs (Beauvallon + Croix-Valmer).
- **Branding par site** dans [`lib/sites.js`](lib/sites.js) (non secret) : `cotedazur`, `beauvallon`, `croixvalmer` (nom, site, footer, téléphone, logo, lien avis Google).
- **Le site d'une réservation** est résolu par `resolveSite(host, ?site=)` : priorité au paramètre `?site=` de l'URL, puis au domaine, puis défaut — **verrouillé** aux sites de `SITES_ENABLED`.
- **Isolation forte** : la route ne **stocke** (`POST`) et ne **lit** (`GET`) que les sites de `SITES_ENABLED`. Une résa d'un autre site ne peut ni entrer ni s'afficher. + volumes séparés par app. → pas besoin de branche git par marque.
- **Dashboard** : si plusieurs sites, des **boutons de filtre** (Tous / par site) + un **badge de site** par carte ; le titre s'adapte au site choisi.

## 3. Déploiements
- **Côte d'Azur** (les "boss") : app séparée, `SITES_ENABLED=cotedazur`, domaine `resa.efoilcotedazur.fr` (+ `resa.bakabi.fr` en secours). Email envoyé "eFoil Côte d'Azur".
- **Beauvallon + Croix-Valmer** (le nouveau moniteur) : **une seule app**, `SITES_ENABLED=beauvallon,croixvalmer`, **un seul domaine `resa.efoil-beauvallon.fr`**. Le moniteur bascule entre les 2 sites avec un bouton.
  - Site Beauvallon → `storeEndpoint = https://resa.efoil-beauvallon.fr/api/reservations?site=beauvallon`
  - Site Croix-Valmer → `https://resa.efoil-beauvallon.fr/api/reservations?site=croixvalmer` (le domaine "beauvallon" est NORMAL = back-office mutualisé).

## 4. Variables d'environnement (runtime Coolify — JAMAIS Build Variable)
Accès : `DASHBOARD_PASSWORD`, `DASHBOARD_SECRET`, `DASHBOARD_URL`, `DATA_DIR=/app/data`.
Sites : `SITES_ENABLED` (ex. `beauvallon,croixvalmer`). Branding par défaut éventuel : `BRAND_*` (repli si site inconnu).
E-mail (SMTP OVH Email Pro) : `SMTP_HOST=ex5.mail.ovh.net`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=Contact@efoilcotedazur.com`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `OWNER_EMAIL` (mail du gérant/moniteur), `BCC_ALL` (archive globale, reçoit TOUT y compris les mails clients, en copie cachée).
WhatsApp (CallMeBot) : `WHATSAPP_PHONE`/`WHATSAPP_APIKEY` puis `…2`…`…20` (chaque numéro a SA clé). Voir [`.env.example`](.env.example) pour la liste complète commentée.

## 5. Fonctionnalités du dashboard
Statuts : **En attente / Confirmée / Créneau proposé / Annulée**. Cartes (mobile-first, pas de scroll latéral), date orange `JJ/MM/AAAA`.
Actions (connecté) : **Confirmer + e-mail** (valide + mail au client), **Renvoyer l'e-mail**, **Proposer un créneau** (modal : date + heure + 3 modèles de message + texte libre → mail de proposition, statut "proposé"), **Annuler** (modal : *avec mail* / *sans mail* / retour), **Réactiver**, **Supprimer** (uniquement après annulation, avec confirmation), boutons **copier** tél/e-mail.
Filtres : **période** (À venir / Passées / Toutes) + **site** (multi-sites) + vue **Liste / Par jour**.

## 6. E-mails (gabarits dans [`lib/notify.js`](lib/notify.js))
Réception client (48 h, no-reply), notif gérant, **validation** (confirmation), **proposition** de créneau, **annulation**. Branding choisi selon le **site de la résa**. Aperçus en ligne : **`/apercus.html`** (servis depuis `public/`, données d'exemple). Photo d'en-tête : `public/mail-photo.jpg` (servie via `DASHBOARD_URL`). `BCC_ALL` reçoit tous les envois ; `OWNER_EMAIL` en BCC des mails clients (jamais visible du client) ; **Reply-To = adresse de contact publique uniquement**.

## 7. Contrat des formulaires (NE PAS CASSER)
`POST /api/reservations` en **`text/plain` no-cors**, body = `JSON.stringify(payload)`. Clés : `ref, name, email, phone, formule, date, slot, participants, level, message, hp, createdAt`. Obligatoires : `name`, `date` (`AAAA-MM-JJ`), `slot`. `hp` = honeypot (rempli ⇒ ignoré). `ref` générée côté client. Le serveur ajoute `status`, `siteId`, `createdAt`.

## 8. Fichiers clés
- [`app/api/reservations/route.js`](app/api/reservations/route.js) : GET/POST/PATCH/DELETE/OPTIONS, résolution + isolation du site.
- [`lib/sites.js`](lib/sites.js) : config des marques + résolution/verrouillage de site.
- [`lib/notify.js`](lib/notify.js) : WhatsApp + e-mails (branding par site).
- [`lib/store.js`](lib/store.js) : stockage JSON (`add/setStatus/update/remove/stats`).
- [`app/page.jsx`](app/page.jsx) : le dashboard (cartes, filtres, modals).

## 9. Reste à faire / pistes
- **Paiement SumUp** : retiré pour l'instant. Le lien simple `pay.sumup.com/b2c/…` **ne permet pas** de savoir si c'est payé. Pour un **statut "Payé" automatique**, il faut l'**API SumUp (Checkouts + webhook)** + compte marchand → à brancher plus tard.
- **Disponibilités / anti-doublon** : non fait (capacité variable selon planches/RDV). À définir : capacité par créneau + grille horaires, puis `GET /api/availability` + garde serveur anti-double-réservation.
- **Google Agenda** : prévu (compte de service Google + partage de l'agenda du gérant) → créer un event à la confirmation.
- **Proposition avec bouton "J'accepte"** (auto-confirmation + agenda) : phase 2 (liens sécurisés + page de réponse).
- **Fusion totale** : on pourra ajouter `cotedazur` au système multi-sites le jour voulu (architecture déjà prête).

## 10. Pièges connus
- Variables Coolify : **runtime**, jamais *Build Variable* (sinon invisibles → ex. mot de passe "incorrect").
- **Déployer la BONNE app** (ne pas confondre avec d'autres projets Coolify). Vérifier le commit déployé.
- **Ne jamais lancer `npm run build` pendant que `npm run dev` tourne** → corrompt `.next` (erreur `Cannot find module './xxx.js'`, 500). Réparer : stopper dev, supprimer `.next`, relancer.
- **Commits via PowerShell** : pas de guillemets doubles dans le message (casse le here-string).
- DNS : `resa.<domaine>` → A → `162.55.35.65` (chez OVH pour les sites eFoil ; Cloudflare pour bakabi).
