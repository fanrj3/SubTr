import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getInitialThemeScript } from "@/lib/client/theme";
import { getInitialUILangScript } from "@/lib/client/i18n";
import { PageTransition } from "@/components/page-transition";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SubTr — subtitle-style translation reader",
  description: "Paste text, turn on translation mode, and read with live subtitles.",
};

export default function RootLayout(props: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: getInitialThemeScript() }} />
        <script dangerouslySetInnerHTML={{ __html: getInitialUILangScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PageTransition>{props.children}</PageTransition>
      </body>
    </html>
  );
}
