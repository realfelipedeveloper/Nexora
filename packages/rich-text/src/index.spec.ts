import { describe, expect, it } from "vitest";
import {
  createEmptyRichTextDocument,
  isSafeRichTextHref,
  normalizeRichTextDocument,
  renderRichTextHtml,
  richTextAssetIds,
  richTextPlainText,
} from "./index.js";

const assetId = "00000000-0000-4000-8000-000000000001";

describe("structured rich text", () => {
  it("migrates legacy text into the versioned document contract", () => {
    const document = normalizeRichTextDocument("First paragraph\nSecond paragraph");
    expect(document).toMatchObject({ schemaVersion: 1, type: "doc" });
    expect(richTextPlainText(document)).toBe("First paragraph Second paragraph");
  });

  it("accepts bounded links and asset references", () => {
    const document = normalizeRichTextDocument({
      content: [
        {
          content: [
            {
              marks: [{ attrs: { href: "https://nexora.local/news" }, type: "link" }],
              text: "News",
              type: "text",
            },
          ],
          type: "paragraph",
        },
        {
          attrs: {
            altText: "Nexora mark",
            assetId,
            caption: null,
            displayName: "brand.png",
            kind: "image",
          },
          type: "asset",
        },
      ],
      schemaVersion: 1,
      type: "doc",
    });

    expect(richTextAssetIds(document)).toEqual([assetId]);
    expect(document.content[0]?.content?.[0]?.marks?.[0]).toMatchObject({
      attrs: { rel: "noopener noreferrer" },
    });
    expect(isSafeRichTextHref("/about")).toBe(true);
    expect(isSafeRichTextHref("javascript:alert(1)")).toBe(false);
  });

  it("renders escaped text, safe links, and server-resolved assets", () => {
    const html = renderRichTextHtml(
      {
        content: [
          { content: [{ text: "<script>alert(1)</script>", type: "text" }], type: "paragraph" },
          {
            attrs: { altText: "Logo", assetId, displayName: "logo.png", kind: "image" },
            type: "asset",
          },
        ],
        schemaVersion: 1,
        type: "doc",
      },
      (id) => `/api/core/public/sites/docs/assets/${id}/content`,
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain(`/assets/${assetId}/content`);
  });

  it.each([
    {
      content: [
        {
          content: [
            {
              marks: [{ attrs: { href: "javascript:alert(1)" }, type: "link" }],
              text: "unsafe",
              type: "text",
            },
          ],
          type: "paragraph",
        },
      ],
      schemaVersion: 1,
      type: "doc",
    },
    {
      content: [{ attrs: { onclick: "alert(1)" }, content: [], type: "paragraph" }],
      schemaVersion: 1,
      type: "doc",
    },
    {
      content: [{ content: [], type: "script" }],
      schemaVersion: 1,
      type: "doc",
    },
  ])("rejects XSS-bearing or unknown document structures", (document) => {
    expect(() => normalizeRichTextDocument(document)).toThrow();
  });

  it("provides a valid empty document", () => {
    expect(normalizeRichTextDocument(createEmptyRichTextDocument())).toEqual(
      createEmptyRichTextDocument(),
    );
  });
});
