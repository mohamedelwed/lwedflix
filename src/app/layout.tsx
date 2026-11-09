import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import DockBar from "@/components/DockBar";
import AppShell from "@/components/app/AppShell";
import TvNavigation from "@/components/tv/TvNavigation";
import { AuthProvider } from "@/components/AuthProvider";
import { WatchlistProvider } from "@/components/WatchlistProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The window title is fixed to "Lwedflix" by electron/main.js; page titles
// still matter for history entries and dev in a browser.
export const metadata: Metadata = {
  title: {
    default: "Lwedflix",
    template: "%s · Lwedflix",
  },
  description: "Movies, shows and anime, with watch parties.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground">
        <AuthProvider>
          <WatchlistProvider>
            <AppShell>{children}</AppShell>
            {/* Floating friends-watching dock. Renders nothing when signed
                out or when nobody is watching, so it never occupies a
                corner of every page for no reason. */}
            <DockBar />
            {/* Remote-control navigation; only in the TV app. */}
            <TvNavigation />
          </WatchlistProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
