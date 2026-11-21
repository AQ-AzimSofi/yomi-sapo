import type { Metadata } from "next";
import React from "react";
import { Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";

// Japanese glyphs arrive in on-demand unicode-range slices, so there is nothing useful to preload.
const shipporiMincho = Shippori_Mincho({
  variable: "--font-shippori-mincho",
  weight: ["500", "700"],
  subsets: ["latin"],
  preload: false,
});

const zenKakuGothic = Zen_Kaku_Gothic_New({
  variable: "--font-zen-kaku-gothic",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "よみサポ",
  description: "A tool to help you read and understand your target language(jp) better.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${shipporiMincho.variable} ${zenKakuGothic.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
