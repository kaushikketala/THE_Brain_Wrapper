import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Brain · SME Gateway",
  description: "A simple client for chatting with your local SME agents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
