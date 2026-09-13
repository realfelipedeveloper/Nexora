import { z } from "zod";

const productNameSchema = z.string().trim().min(1).max(80);
const displayNameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().min(1).max(500);

export const globalConfigurationSchemas = Object.freeze({
  "platform.branding": z.strictObject({
    productName: productNameSchema,
  }),
});

export const siteConfigurationSchemas = Object.freeze({
  "site.identity": z.strictObject({
    description: descriptionSchema.optional(),
    displayName: displayNameSchema,
  }),
});

export type GlobalConfigurationKey = keyof typeof globalConfigurationSchemas;
export type SiteConfigurationKey = keyof typeof siteConfigurationSchemas;

export type GlobalConfigurationValues = {
  [Key in GlobalConfigurationKey]: z.infer<(typeof globalConfigurationSchemas)[Key]>;
};

export type SiteConfigurationValues = {
  [Key in SiteConfigurationKey]: z.infer<(typeof siteConfigurationSchemas)[Key]>;
};

export const initialFieldTypes = [
  "text",
  "textarea",
  "richText",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "media",
  "gallery",
  "relation",
  "taxonomy",
  "url",
  "email",
  "color",
  "json",
] as const;

export const fieldTypeSchema = z.enum(initialFieldTypes);

export const fieldDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  fieldType: fieldTypeSchema,
  required: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).default({}),
});

export type InitialFieldType = (typeof initialFieldTypes)[number];
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
