import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novatrix',
  description: 'Novatrix — autonomous security assessment console (authorized testing only)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
