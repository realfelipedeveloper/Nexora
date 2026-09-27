import type { Metadata } from "next";
import { ContentPreviewClient } from "./preview-client";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Content preview | Nexora",
};

export default function ContentPreviewPage() {
  return <ContentPreviewClient />;
}
