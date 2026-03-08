import type { Metadata } from "next";
import { Satisfy } from "next/font/google";
import "./globals.css";

const satisfy = Satisfy({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-satisfy",
});

export const metadata: Metadata = {
  title: "Correx",
  description: "Robotic task verification & real-time safety compliance layer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`min-h-screen bg-[#f8f8f7] ${satisfy.variable}`}>
        {children}
      </body>
    </html>
  );
}
