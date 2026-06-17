# eFoil Côte d'Azur — Dashboard réservations

Petite app **Next.js** : reçoit les réservations du site et les affiche dans un
**dashboard** (vue publique = nombre de personnes + créneaux ; **mot de passe**
pour dévoiler nom/téléphone/e-mail). Pensée pour **Coolify** (déploiement Git).

## Routes
- `GET /` — le dashboard.
- `POST /api/reservations` — enregistre une réservation (appelé par le formulaire du site, JSON).
- `GET /api/reservations` — liste + stats (données perso seulement si connecté).
- `POST /api/login` `{password}` / `POST /api/logout` — accès aux données confidentielles.

## Lancer en local
```bash
npm install
cp .env.example .env   # renseigner DASHBOARD_PASSWORD + DASHBOARD_SECRET
npm run dev            # http://localhost:3000
```

## Déploiement Coolify (résumé)
1. Pousser ce dossier dans un repo Git.
2. Coolify → New Resource → **Application** depuis ce repo (build par Dockerfile).
3. **Variables d'env** : `DASHBOARD_PASSWORD`, `DASHBOARD_SECRET`, `DATA_DIR=/app/data` (+ `WHATSAPP_*` optionnel).
4. **Volume persistant** : monter un volume sur **`/app/data`** (sinon les réservations sont perdues à chaque redeploy).
5. Domaine : sous-domaine de bakabi via Cloudflare (ex. `resa.bakabi.xxx`).
6. Côté site : mettre cette URL d'API dans `efoilcotedazur/assets/js/efca-config.js` →
   `booking.storeEndpoint = "https://resa.bakabi.xxx/api/reservations"`.

Détails complets et contrat de données : voir **CLAUDE-HANDOFF.md**.
