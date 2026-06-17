# Dashboard réservations eFoil Côte d'Azur — Next.js
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Copie de l'app construite
COPY --from=build /app ./
# Le dossier data est destiné à un VOLUME PERSISTANT Coolify (sur /app/data)
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["npm", "start"]
