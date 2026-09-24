import {
  contentEntrySnapshotLocalesSchema,
  type ContentEntrySnapshotLocale,
} from "@nexora/schemas";

type ContentEntryFieldDiffContext = {
  fieldKey: string;
  localeCode: string;
  localeId: string;
};

export type ContentEntryFieldDiff =
  | (ContentEntryFieldDiffContext & {
      after: unknown;
      change: "ADDED";
    })
  | (ContentEntryFieldDiffContext & {
      before: unknown;
      change: "REMOVED";
    })
  | (ContentEntryFieldDiffContext & {
      after: unknown;
      before: unknown;
      change: "CHANGED";
    });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        Object.hasOwn(right, key) &&
        jsonValuesEqual(left[key], right[key]),
    )
  );
}

function localeSortKey(locale: ContentEntrySnapshotLocale) {
  return `${locale.localeCode}\u0000${locale.localeId}`;
}

export function generateContentEntryFieldDiff(
  before: readonly ContentEntrySnapshotLocale[],
  after: readonly ContentEntrySnapshotLocale[],
): ContentEntryFieldDiff[] {
  const parsedBefore = contentEntrySnapshotLocalesSchema.parse(before);
  const parsedAfter = contentEntrySnapshotLocalesSchema.parse(after);
  const beforeById = new Map(parsedBefore.map((locale) => [locale.localeId, locale]));
  const afterById = new Map(parsedAfter.map((locale) => [locale.localeId, locale]));
  const locales = [
    ...new Map(
      [...parsedBefore, ...parsedAfter].map((locale) => [locale.localeId, locale]),
    ).values(),
  ].sort((left, right) => {
    const leftKey = localeSortKey(left);
    const rightKey = localeSortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const differences: ContentEntryFieldDiff[] = [];

  for (const { localeCode, localeId } of locales) {
    const beforeLocale = beforeById.get(localeId);
    const afterLocale = afterById.get(localeId);
    const beforeData = beforeLocale?.data ?? {};
    const afterData = afterLocale?.data ?? {};

    const fieldKeys = [...new Set([...Object.keys(beforeData), ...Object.keys(afterData)])].sort();
    for (const fieldKey of fieldKeys) {
      const context = { fieldKey, localeCode, localeId };
      const existedBefore = Object.hasOwn(beforeData, fieldKey);
      const existsAfter = Object.hasOwn(afterData, fieldKey);
      if (!existedBefore) {
        differences.push({ ...context, after: afterData[fieldKey], change: "ADDED" });
      } else if (!existsAfter) {
        differences.push({ ...context, before: beforeData[fieldKey], change: "REMOVED" });
      } else if (!jsonValuesEqual(beforeData[fieldKey], afterData[fieldKey])) {
        differences.push({
          ...context,
          after: afterData[fieldKey],
          before: beforeData[fieldKey],
          change: "CHANGED",
        });
      }
    }
  }

  return differences;
}
