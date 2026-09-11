import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Nexora",
  description: "Universal web platform with an embedded CMS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
