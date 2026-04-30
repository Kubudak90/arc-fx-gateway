import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ChainProviders } from "@/lib/chain/wagmi-config";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const interDisplay = Inter({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["400", "500", "600", "700"] });
const jetMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Arcora",
  description: "Stablecoin checkout and FX settlement on Arc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interDisplay.variable} ${jetMono.variable}`}>
      <body className="font-sans antialiased">
        <ChainProviders>{children}</ChainProviders>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
