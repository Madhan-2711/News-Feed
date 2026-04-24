import { Playfair_Display, Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata = {
  title: "News Feed — Curated Intelligence",
  description: "AI-powered personalized news, beautifully curated. Discovery, extraction, and intelligence — delivered daily.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${playfair.variable} ${sourceSans.variable} ${ibmPlexMono.variable}`}>
      <body className={sourceSans.className}>
        {children}
      </body>
    </html>
  );
}
