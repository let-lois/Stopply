import type { Metadata } from 'next';
import './globals.css';
import { themeInitScript } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Stopply',
  description: 'Marketing attribution dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply the saved light/dark preference before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Stamps which build is serving the page. Answering "is this fix
            deployed?" had meant inferring it from whether a symptom moved,
            which is slow and gets it wrong. window.STOPPLY_BUILD is also
            readable from the console. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.STOPPLY_BUILD=${JSON.stringify({
              sha: process.env.NEXT_PUBLIC_BUILD_SHA,
              branch: process.env.NEXT_PUBLIC_BUILD_BRANCH,
            })};console.info('Stopply build',window.STOPPLY_BUILD.sha,'('+window.STOPPLY_BUILD.branch+')');`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Spline+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* viewport-fit=cover lets the field app's fixed header and tab bar
            sit under the notch and home indicator using env(safe-area-inset-*).
            No effect on the dashboard. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>{children}</body>
    </html>
  );
}
