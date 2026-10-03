import "~/styles/globals.css";

import { Archivo_Black, Inter, Space_Grotesk } from "next/font/google";
import { type Metadata } from "next";
import { Header } from "~/components/header";
import { ScrollProgress } from "~/components/scroll-progress";
import { Footer } from "~/components/footer";
import { LivePresence } from "~/components/live-presence";
import { CSPostHogProvider } from "./providers";
import { SponsorCampaignProvider } from "~/hooks/use-sponsor-campaign";
import { renderedSponsorSchedule } from "~/lib/sponsor-campaign";
import { SITE_URL } from "~/lib/site";
import { chunkReloadScript } from "~/lib/chunk-reload";

const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo-black",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "GitDiagram",
  description:
    "Turn any GitHub repository into an interactive diagram for visualization in seconds.",
  metadataBase: new URL(SITE_URL),
  keywords: [
    "github",
    "git diagram",
    "git diagram generator",
    "git diagram tool",
    "git diagram maker",
    "git diagram creator",
    "diagram",
    "repository",
    "visualization",
    "code structure",
    "system design",
    "software architecture",
    "software design",
    "software engineering",
    "software development",
    "open source",
    "open source software",
    "sripavantejb",
    "sripavantejb",
    "gitdiagram",
    "localhost:3000",
  ],
  authors: [
    { name: "sripavantejb", url: "https://github.com/sripavantejb" },
  ],
  creator: "sripavantejb",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    title: "GitDiagram - Repository to Diagram in Seconds",
    description:
      "Turn any GitHub repository into an interactive diagram for visualization.",
    siteName: "GitDiagram",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitDiagram - Repository to Diagram in Seconds",
    description:
      "Turn any GitHub repository into an interactive diagram for visualization.",
    creator: "@sripavantejb",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivoBlack.variable} ${inter.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        {/* Before any chunk loads: reload once if one fails (see chunk-reload.ts). */}
        <script dangerouslySetInnerHTML={{ __html: chunkReloadScript }} />
      </head>
      <body className="flex min-h-screen flex-col font-inter">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <ScrollProgress />
        <CSPostHogProvider>
          <SponsorCampaignProvider {...renderedSponsorSchedule()}>
            <Header />
            <div id="main" tabIndex={-1} className="flex-grow outline-none">
              {children}
            </div>
            <Footer />
          </SponsorCampaignProvider>
          <LivePresence />
        </CSPostHogProvider>
      </body>
    </html>
  );
}
