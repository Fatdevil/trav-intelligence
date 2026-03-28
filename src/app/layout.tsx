import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Trav Intelligence (TI)',
  description: 'AI-driven analys för svenskt trav',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <body>
        <nav style={{ 
          background: 'rgba(0,0,0,0.6)', 
          backdropFilter: 'blur(10px)',
          borderBottom: '2px solid rgba(57, 255, 20, 0.4)',
          padding: '1.2rem 2rem',
          display: 'flex',
          justifyContent: 'center',
          gap: '3rem',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
        }}>
          <Link href="/" style={{color: '#fff', textDecoration: 'none', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', fontSize: '1.1rem'}}>🎲 Systembyggaren</Link>
          <Link href="/insights" style={{color: '#39ff14', textDecoration: 'none', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', fontSize: '1.1rem'}}>🧠 AI-Minnet</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
