import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Zyrox Control Room", description: "Real-time Discord server operations" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="dark"><body>{children}</body></html>; }
