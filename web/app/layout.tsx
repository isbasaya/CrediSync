import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'CrediSync',
  description: "South Africa's real-time, multi-bureau credit orchestration platform",
};

const DIRECTION_CONTRACT = `
THESIS: Trust reads as native fluency — CrediSync should feel like the banking app 20 million South Africans already use daily, not an imported SaaS template wearing navy as a trust costume.
OWN-WORLD: Light ivory ground, near-black ink, one confident deep-teal accent; bold rounded numerals replace gauges; type scale and weight carry hierarchy, never card chrome or borders.
STORY: A consumer sees one honest number with visible bureau provenance, understands what is dragging it down at a glance by size alone, and always has a next action — dispute or readiness guidance.
FIRST VIEWPORT: Header, then a full-width score hero where three bureau numerals visibly settle before the unified score assembles a beat behind them (the signature interaction); severity-ranked figures and accounts follow — no uniform tile grid.
FORM: Home Ground, direction 1 of 7 (assigned), seed key 15a40592.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={inter.variable}>
      <body className="min-h-dvh font-sans antialiased">
        {/* eslint-disable-next-line react/no-danger -- literal HTML comment carrying the direction contract, must survive to the built markup */}
        <template dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }} />
        {children}
      </body>
    </html>
  );
}
