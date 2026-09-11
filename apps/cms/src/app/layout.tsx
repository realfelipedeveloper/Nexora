import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Nexora CMS",
  description: "Embedded CMS foundation for Nexora.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
