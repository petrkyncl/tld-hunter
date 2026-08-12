import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TLD Hunter — every TLD for one name",
  description:
    "Type one name and sweep every TLD on earth: what is available, what is for sale and at what price, what is taken.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
