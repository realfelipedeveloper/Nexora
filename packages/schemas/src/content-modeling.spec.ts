import { describe, expect, it } from "vitest";
import {
  contentLocaleDataSchema,
  contentSchemaVersionSchema,
  contentTypeKeySchema,
  contentTypeSchemaDefinitionSchema,
  fieldDefinitionSchema,
} from "./index.js";

describe("content modeling contracts", () => {
  it("accepts canonical content type keys and rejects ambiguous identifiers", () => {
    expect(contentTypeKeySchema.parse("institutional-page")).toBe("institutional-page");
    expect(contentTypeKeySchema.safeParse("Institutional Page").success).toBe(false);
    expect(contentTypeKeySchema.safeParse("content_type").success).toBe(false);
  });

  it("keeps field definitions bounded, typed, and object-configured", () => {
    expect(
      fieldDefinitionSchema.parse({
        fieldType: "richText",
        key: "body",
        label: "Body",
      }),
    ).toEqual({
      config: {},
      fieldType: "richText",
      key: "body",
      label: "Body",
      position: 0,
      required: false,
    });

    expect(
      fieldDefinitionSchema.safeParse({
        config: [],
        fieldType: "richText",
        key: "body",
        label: "Body",
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({
        fieldType: "unsupported",
        key: "body",
        label: "Body",
      }).success,
    ).toBe(false);
  });

  it("requires object content data and positive schema versions", () => {
    expect(contentLocaleDataSchema.safeParse({ title: "Nexora" }).success).toBe(true);
    expect(contentLocaleDataSchema.safeParse(["Nexora"]).success).toBe(false);
    expect(contentSchemaVersionSchema.safeParse(1).success).toBe(true);
    expect(contentSchemaVersionSchema.safeParse(0).success).toBe(false);
  });

  it("accepts bounded, typed schema snapshots for a content type version", () => {
    expect(
      contentTypeSchemaDefinitionSchema.parse({
        displayName: "Institutional Page",
        fields: [{ fieldType: "text", key: "title", label: "Title" }],
        key: "institutional-page",
        version: 2,
      }),
    ).toMatchObject({
      fields: [{ key: "title", position: 0 }],
      version: 2,
    });
    expect(
      contentTypeSchemaDefinitionSchema.safeParse({
        displayName: "Institutional Page",
        fields: [],
        key: "institutional-page",
        version: 0,
      }).success,
    ).toBe(false);
  });
});
