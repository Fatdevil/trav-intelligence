import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trav Edge — Kvantitativ Travanalys',
  description: 'Professionell statistisk analysplattform för svenskt trav. LightGBM-driven edge-identifiering.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <body style={{ margin: 0, padding: 0, background: '#0F1117' }}>
        {children}
      </body>
    </html>
  );
}
