import "./globals.css";

export const metadata = {
  title: "Réservations eFoil",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
