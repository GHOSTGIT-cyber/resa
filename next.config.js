/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // L'app stocke les réservations dans un fichier JSON sous ./data
  // -> monter un VOLUME PERSISTANT Coolify sur /app/data (voir CLAUDE-HANDOFF.md).
};
module.exports = nextConfig;
