# NOTES DE PASSATION — Dashboard réservations eFoil Côte d'Azur

> Pour le prochain Claude qui reprend ce projet. Lis ça en entier avant d'agir.

## 1. Contexte global
- Client : **eFoil Côte d'Azur** (location de foil électrique, Mandelieu / Cannes). Site WordPress `efoilcotedazur.fr`.
- Le user **refait le site en HTML/CSS statique custom** (dossier `d:\efoil_sites\efoilcotedazur\`) pour remplacer le thème **Swift / Elementor** qu'il va désactiver. Page d'accueil = `index.html`, page de réservation = `reservation.html`.
- Le user déploie ses apps sur un **serveur Coolify** (mises à jour par **Git**), sous-domaines de **bakabi** propagés via **Cloudflare**.
- Cette app (`efca-dashboard/`) est le **back de réservation** : stockage + dashboard. Choix techno validé : **Next.js** (vs PHP), stockage **fichier JSON** (pas de Postgres pour démarrer).

## 2. Ce qui est déjà fait (état actuel)
- **Connexion MCP WordPress** opérationnelle (plugin WordPress MCP + token JWT). Endpoint :
  `https://efoilcotedazur.fr/wp-json/wp/v2/wpmcp/streamable` (Bearer JWT). Config dans `d:\efoil_sites\.mcp.json`.
  ⚠️ Le **token JWT expire** (~30 j) ; si 401, le user régénère dans wp-admin → MCP. Outils **Create/Update activés, Delete DÉSACTIVÉ** (donc on ne peut pas supprimer de média/page via MCP).
- Site statique **buildé et testable sans Swift** : images + 9 vidéos reels uploadées dans la médiathèque WP
  (`/wp-content/uploads/2026/06/efca-*`). Pages WP brouillons : **Accueil = id 20250**, **Réservation = id 20252**.
  Tests autonomes (HTML uploadé, CSS inliné) : `efca-accueil-v5.html` / `efca-reservation-v3.html`.
- **Réservation sans paiement** déjà fonctionnelle côté navigateur (`assets/js/efca-booking.js`) :
  notifs **WhatsApp (CallMeBot)** + **e-mail (FormSubmit)**. Réglages dans `assets/js/efca-config.js` (bloc `booking`).
  Numéro WhatsApp de test du user : **0623754582** (international `33623754582`).

## 3. Ce que fait CETTE app
- `POST /api/reservations` : reçoit la réservation (JSON) et l'ajoute à `data/reservations.json`.
- `GET /api/reservations` : renvoie `{authed, stats, reservations}`. **Sans mot de passe** = stats + lignes
  SANS données perso (date, créneau, participants, formule). **Avec cookie** = + nom/tél/e-mail/message.
- `POST /api/login {password}` (cookie 12 h) / `POST /api/logout`.
- Dashboard `/` : cartes (nb réservations, participants, créneaux, dates), participants par créneau, table.
  Vue publique conforme à la demande : **« réservations en nombre de personnes + horaires choisis »**.
  Bouton mot de passe pour dévoiler le confidentiel.
- Notif **WhatsApp serveur OPTIONNELLE** (CallMeBot) si `WHATSAPP_PHONE` + `WHATSAPP_APIKEY` définis (sinon ignorée).

## 4. CONTRAT DE DONNÉES (front ↔ API) — ne pas casser
Le formulaire `efca-booking.js` poste un JSON avec ces clés :
```
ref, name, email, phone, formule, date, slot, participants, level, message, hp(honeypot), createdAt
```
- Le POST se fait en `fetch(..., {mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}})`
  → requête "simple", **pas de préflight CORS**, **réponse non lue** par le navigateur.
  Donc l'API lit `request.text()` puis `JSON.parse`. Ne pas exiger application/json.
- `hp` rempli = bot → l'API répond 200 sans rien stocker.
- La **référence** (`ref`, ex. `EFCA-260617-AB12`) est générée côté client ; on la conserve.

## 5. Brancher le site sur cette app (à faire une fois déployé)
Dans `d:\efoil_sites\efoilcotedazur\assets\js\efca-config.js`, bloc `booking` :
```js
storeEndpoint: 'https://resa.bakabi.xxx/api/reservations'   // <-- URL Coolify réelle
```
Puis **régénérer** les pages (voir §7) pour pousser la nouvelle config dans les versions WP/test.

## 6. Déploiement Coolify (pas à pas)
1. Pousser `efca-dashboard/` dans un repo Git.
2. Coolify → Application → ce repo → **build par Dockerfile** (présent).
3. Env vars : `DASHBOARD_PASSWORD`, `DASHBOARD_SECRET` (longue chaîne random), `DATA_DIR=/app/data`,
   et si notif serveur voulue : `WHATSAPP_PHONE=33623754582`, `WHATSAPP_APIKEY=...` (clé CallMeBot du user).
4. **VOLUME PERSISTANT** monté sur **`/app/data`** ← INDISPENSABLE, sinon les résa disparaissent à chaque redeploy.
5. Port exposé : 3000. Domaine : `resa.bakabi.xxx` (Cloudflare).
6. Tester : ouvrir le domaine (vue publique) ; POST de test ; saisir le mot de passe → données visibles.

## 7. Régénérer / repousser le site (rappel du process utilisé)
Les pages WP et les tests autonomes sont générés en **inlinant** `efca.css` + JS et en **réécrivant**
les chemins `assets/img|video` vers les URLs médiathèque WP. Script type (Python + endpoint MCP) :
upload média base64 → `wp_upload_media` ; maj page → `wp_update_page` (id 20250 / 20252) ;
upload HTML autonome → `wp_upload_media` (slug versionné, ex. `efca-accueil-v6`).
⚠️ Pas de delete via MCP → versionner les slugs (v5, v6…) et demander au user de purger les vieux dans *Médias*.


