import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Nexora",
  description: "Conteúdo publicado com Nexora.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={process.env.NEXORA_PUBLIC_LOCALE ?? "pt-BR"}>
      <body>{children}</body>
    </html>
  );
}
