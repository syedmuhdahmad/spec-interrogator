import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Fonts are bundled with the app (no request to a third-party font host).
import "@fontsource/press-start-2p/latin-400.css";
import "@fontsource/silkscreen/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spec Interrogator | Multi-agent QA analyst",
  description:
    "Paste a user story or a public GitHub issue. Eight AI agents find the ambiguities, write a validated Gherkin test suite and hand back a test plan ranked by risk.",
  applicationName: "Spec Interrogator",
  authors: [{ name: "Syed Muhammad Ahmad" }],
  openGraph: {
    title: "Spec Interrogator",
    description: "Eight agents interrogate a requirement before the sprint starts.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e0f14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <a
          href="#workbench"
          className="lbl sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-yellow focus:px-3 focus:py-2 focus:text-bg"
        >
          Skip to the workbench
        </a>
        {children}
      </body>
    </html>
  );
}
