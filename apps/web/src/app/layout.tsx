import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'SSMI — Smart Sales Meeting Intelligence',
  description:
    'AI-powered meeting intelligence for sales professionals. Automatically capture, analyse, and summarise your customer meetings with precision.',
  keywords: ['sales', 'meeting intelligence', 'AI', 'transcription', 'sales productivity'],
  openGraph: {
    title: 'SSMI — Smart Sales Meeting Intelligence',
    description: 'Turn every sales meeting into actionable intelligence.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <Navbar />
        <main style={{ position: 'relative', zIndex: 1 }}>{children}</main>
      </body>
    </html>
  );
}
