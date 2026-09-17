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

export const siteCreateSchema = z.strictObject({
  key: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
  name: z.string().trim().min(1).max(120),
});

export const siteStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const siteStatusUpdateSchema = z.strictObject({
  status: siteStatusSchema,
});

export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteStatus = z.infer<typeof siteStatusSchema>;
export type SiteStatusUpdateInput = z.infer<typeof siteStatusUpdateSchema>;

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

export const contentTypeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);

export const fieldDefinitionKeySchema = contentTypeKeySchema;

export const contentSchemaVersionSchema = z.number().int().positive();

export const contentLocaleDataSchema = z.record(z.string(), z.unknown());

export const fieldDefinitionSchema = z.strictObject({
  key: fieldDefinitionKeySchema,
  label: z.string().trim().min(1).max(120),
  fieldType: fieldTypeSchema,
  required: z.boolean().default(false),
  position: z.number().int().nonnegative().default(0),
  config: contentLocaleDataSchema.default({}),
});

export const contentTypeSchemaDefinitionSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  fields: z.array(fieldDefinitionSchema).max(100),
  key: contentTypeKeySchema,
  version: contentSchemaVersionSchema,
});

export type InitialFieldType = (typeof initialFieldTypes)[number];
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
