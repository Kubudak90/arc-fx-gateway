import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ChainProviders } from "@/lib/chain/wagmi-config";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const interDisplay = Inter({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "Arc FX Gateway",
  description: "USDC ⇄ EURC payments on Arc Network",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interDisplay.variable}`}>
      <body className="font-sans antialiased">
        <ChainProviders>{children}</ChainProviders>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
