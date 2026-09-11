import { z } from "zod";

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
