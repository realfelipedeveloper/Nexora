import { describe, expect, it } from "vitest";
import type { ContentEntrySnapshotLocale } from "@nexora/schemas";
import { generateContentEntryFieldDiff } from "./content-entry-diff.js";

const englishLocaleId = "12e65348-8ee1-4db1-a63d-4daf978cb844";
const portugueseLocaleId = "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6";
const spanishLocaleId = "fdbaaa82-1842-4f71-a59e-7a1fa3975784";

function locale(
  localeId: string,
  localeCode: string,
  data: Record<string, unknown>,
): ContentEntrySnapshotLocale {
  return { data, localeCode, localeId, schemaVersion: 1 };
}

describe("content entry field diff", () => {
  it("reports added, removed, and changed fields in a stable order", () => {
    const before = [
      locale(portugueseLocaleId, "pt-BR", {
        metadata: { enabled: true, position: 1 },
        summary: "Remove this",
        tags: ["cms", "headless"],
        title: "Original",
      }),
    ];
    const after = [
      locale(portugueseLocaleId, "pt-BR", {
        metadata: { position: 1, enabled: true },
        tags: ["cms", "headless"],
        teaser: "New field",
        title: "Updated",
      }),
    ];

    expect(generateContentEntryFieldDiff(before, after)).toEqual([
      {
        before: "Remove this",
        change: "REMOVED",
        fieldKey: "summary",
        localeCode: "pt-BR",
        localeId: portugueseLocaleId,
      },
      {
        after: "New field",
        change: "ADDED",
        fieldKey: "teaser",
        localeCode: "pt-BR",
        localeId: portugueseLocaleId,
      },
      {
        after: "Updated",
        before: "Original",
        change: "CHANGED",
        fieldKey: "title",
        localeCode: "pt-BR",
        localeId: portugueseLocaleId,
      },
    ]);
  });

  it("models fields from removed and added locales", () => {
    const before = [
      locale(portugueseLocaleId, "pt-BR", { title: "Nexora" }),
      locale(englishLocaleId, "en-US", { title: "Nexora" }),
    ];
    const after = [
      locale(spanishLocaleId, "es-ES", { title: "Nexora" }),
      locale(portugueseLocaleId, "pt-BR", { title: "Nexora" }),
    ];

    expect(generateContentEntryFieldDiff(before, after)).toEqual([
      {
        before: "Nexora",
        change: "REMOVED",
        fieldKey: "title",
        localeCode: "en-US",
        localeId: englishLocaleId,
      },
      {
        after: "Nexora",
        change: "ADDED",
        fieldKey: "title",
        localeCode: "es-ES",
        localeId: spanishLocaleId,
      },
    ]);
  });

  it("compares nested JSON structurally and preserves array order", () => {
    const before = [
      locale(portugueseLocaleId, "pt-BR", {
        blocks: [{ id: "hero" }, { id: "body" }],
        settings: { colors: { accent: "#00695c" }, visible: true },
      }),
    ];
    const structurallyEqual = [
      locale(portugueseLocaleId, "pt-BR", {
        blocks: [{ id: "hero" }, { id: "body" }],
        settings: { visible: true, colors: { accent: "#00695c" } },
      }),
    ];
    const reorderedBlocks = [
      locale(portugueseLocaleId, "pt-BR", {
        blocks: [{ id: "body" }, { id: "hero" }],
        settings: { visible: true, colors: { accent: "#00695c" } },
      }),
    ];

    expect(generateContentEntryFieldDiff(before, structurallyEqual)).toEqual([]);
    expect(generateContentEntryFieldDiff(before, reorderedBlocks)).toEqual([
      {
        after: [{ id: "body" }, { id: "hero" }],
        before: [{ id: "hero" }, { id: "body" }],
        change: "CHANGED",
        fieldKey: "blocks",
        localeCode: "pt-BR",
        localeId: portugueseLocaleId,
      },
    ]);
  });

  it("rejects snapshot locale collections outside the shared contract", () => {
    const duplicateLocale = locale(portugueseLocaleId, "pt-BR", { title: "Nexora" });

    expect(() => generateContentEntryFieldDiff([], [duplicateLocale])).toThrow();
    expect(() =>
      generateContentEntryFieldDiff([duplicateLocale], [duplicateLocale, duplicateLocale]),
    ).toThrow();
  });
});
