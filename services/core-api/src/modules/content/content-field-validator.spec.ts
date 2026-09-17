import { describe, expect, it } from "vitest";
import {
  ContentDataInvalidError,
  ContentDataTooLargeError,
  ContentFieldValidator,
  ContentSchemaInvalidError,
  maximumContentBytes,
} from "./content-field-validator.js";

const firstUuid = "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6";
const secondUuid = "a11f740b-f15f-4279-8ca2-3877a4cae775";

const definition = {
  displayName: "Article",
  fields: [
    { config: { minLength: 1 }, fieldType: "text", key: "title", label: "Title", required: true },
    { fieldType: "textarea", key: "summary", label: "Summary" },
    { fieldType: "richText", key: "body", label: "Body" },
    { config: { min: 0 }, fieldType: "integer", key: "priority", label: "Priority" },
    { fieldType: "decimal", key: "rating", label: "Rating" },
    { fieldType: "boolean", key: "featured", label: "Featured" },
    { fieldType: "date", key: "publication-date", label: "Publication date" },
    { fieldType: "datetime", key: "publication-time", label: "Publication time" },
    { config: { options: ["news", "page"] }, fieldType: "select", key: "kind", label: "Kind" },
    {
      config: { maxItems: 2, options: ["public", "internal"] },
      fieldType: "multiSelect",
      key: "audiences",
      label: "Audiences",
    },
    { fieldType: "media", key: "cover", label: "Cover" },
    { config: { maxItems: 2 }, fieldType: "gallery", key: "gallery", label: "Gallery" },
    { fieldType: "relation", key: "parent", label: "Parent" },
    { config: { maxItems: 2 }, fieldType: "taxonomy", key: "terms", label: "Terms" },
    { fieldType: "url", key: "source", label: "Source" },
    { fieldType: "email", key: "contact", label: "Contact" },
    { fieldType: "color", key: "accent", label: "Accent" },
    { fieldType: "json", key: "metadata", label: "Metadata" },
  ],
  key: "article",
  version: 1,
};

describe("ContentFieldValidator", () => {
  const validator = new ContentFieldValidator();

  it("validates all initial field types on the server", () => {
    const data = {
      accent: "#0A7F5A",
      audiences: ["public", "internal"],
      body: "Structured rich text is introduced in SPEC-018.",
      contact: "editor@nexora.local",
      cover: firstUuid,
      featured: true,
      gallery: [firstUuid, secondUuid],
      kind: "news",
      metadata: { featuredReason: "Editorial" },
      parent: secondUuid,
      "publication-date": "2026-09-17",
      "publication-time": "2026-09-17T14:30:00-03:00",
      priority: 1,
      rating: 4.5,
      source: "https://nexora.local/news",
      summary: "Summary",
      terms: [firstUuid],
      title: "Nexora",
    };

    expect(validator.validate(definition, data)).toEqual(data);
  });

  it.each([
    ["text", {}, 42],
    ["textarea", {}, []],
    ["richText", {}, {}],
    ["integer", {}, 1.5],
    ["decimal", {}, "1.5"],
    ["boolean", {}, "true"],
    ["date", {}, "2026-02-31"],
    ["datetime", {}, "2026-09-17T14:30:00"],
    ["select", { options: ["allowed"] }, "denied"],
    ["multiSelect", { options: ["allowed"] }, ["allowed", "allowed"]],
    ["media", {}, "not-a-uuid"],
    ["gallery", {}, ["not-a-uuid"]],
    ["relation", {}, [firstUuid]],
    ["taxonomy", {}, ["not-a-uuid"]],
    ["url", {}, "javascript:alert(1)"],
    ["email", {}, "invalid-email"],
    ["color", {}, "red"],
  ])("rejects invalid %s values", (fieldType, config, value) => {
    expect(() =>
      validator.validate(
        {
          displayName: "Validation",
          fields: [{ config, fieldType, key: "value", label: "Value", required: true }],
          key: "validation",
          version: 1,
        },
        { value },
      ),
    ).toThrow(ContentDataInvalidError);
  });

  it("enforces required fields, configured bounds, and unknown field rejection", () => {
    expect.assertions(4);
    try {
      validator.validate(
        {
          displayName: "Bounded",
          fields: [
            {
              config: { maxLength: 5, minLength: 2 },
              fieldType: "text",
              key: "title",
              label: "Title",
              required: true,
            },
          ],
          key: "bounded",
          version: 1,
        },
        { privateToken: "never-retain-this-value", title: "x" },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ContentDataInvalidError);
      expect(error).toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "unknown_fields" }),
          expect.objectContaining({ code: "invalid_value", fieldKey: "title" }),
        ]),
      });
      expect(JSON.stringify(error)).not.toContain("never-retain-this-value");
      expect(JSON.stringify(error)).not.toContain("privateToken");
    }
  });

  it("rejects invalid schemas before validating content", () => {
    expect(() =>
      validator.validate(
        {
          displayName: "Duplicate",
          fields: [
            { fieldType: "text", key: "title", label: "Title" },
            { fieldType: "text", key: "title", label: "Duplicate" },
          ],
          key: "duplicate",
          version: 1,
        },
        { title: "Nexora" },
      ),
    ).toThrow(ContentSchemaInvalidError);

    expect(() =>
      validator.validate(
        {
          displayName: "Selection",
          fields: [{ config: {}, fieldType: "select", key: "kind", label: "Kind" }],
          key: "selection",
          version: 1,
        },
        { kind: "news" },
      ),
    ).toThrow(ContentSchemaInvalidError);
  });

  it("rejects non-JSON and oversized payloads", () => {
    expect(() => validator.validate(definition, { metadata: new Date() })).toThrow(
      ContentDataInvalidError,
    );
    expect(() =>
      validator.validate(definition, {
        title: "x".repeat(maximumContentBytes),
      }),
    ).toThrow(ContentDataTooLargeError);
  });

  it("supports bounded multi-value relations", () => {
    const relationDefinition = {
      displayName: "Related content",
      fields: [
        {
          config: { maxItems: 2, multiple: true },
          fieldType: "relation",
          key: "related",
          label: "Related",
        },
      ],
      key: "related-content",
      version: 1,
    };

    expect(validator.validate(relationDefinition, { related: [firstUuid, secondUuid] })).toEqual({
      related: [firstUuid, secondUuid],
    });
    expect(() =>
      validator.validate(relationDefinition, { related: [firstUuid, firstUuid] }),
    ).toThrow(ContentDataInvalidError);
  });
});
