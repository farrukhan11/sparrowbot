import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Suspense } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: "1",
  maximumScale: "1",
  userScalable: "false",
};

export const metadata: Metadata = {
  title: "Order Now — Sparrow Official",
  description: "Place your order easily with Sparrow Official. Premium quality clothing delivered to your doorstep.",
  icons: {
    icon: "/sparrow-logo.svg",
    shortcut: "/sparrow-logo.svg",
    apple: "/sparrow-logo.svg",
  },
  openGraph: {
    title: "Sparrow Official — Order Assistant",
    description: "Place your order easily with Sparrow Official.",
    images: ["/sparrow-logo.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Suspense>{children}</Suspense>
        <Toaster />
      </body>
    </html>
  );
}
