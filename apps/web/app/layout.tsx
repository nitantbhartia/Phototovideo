import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "ListingReel — AI Real Estate Listing Videos",
    template: "%s | ListingReel",
  },
  description:
    "Turn your listing photos into cinematic narrated videos in 5 minutes. AI-powered real estate videos for $49 — no videographer needed.",
  keywords: [
    "real estate video",
    "listing video",
    "AI real estate",
    "property video",
    "MLS video",
  ],
  openGraph: {
    title: "ListingReel — AI Real Estate Listing Videos",
    description:
      "Turn your listing photos into cinematic narrated videos in 5 minutes.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={`${inter.variable} font-sans`}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
