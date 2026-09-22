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

export type InitialFieldType = (typeof initialFieldTypes)[number];

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

function boundedLengthConfiguration(maximum: number) {
  return z
    .strictObject({
      maxLength: z.number().int().positive().max(maximum).default(maximum),
      minLength: z.number().int().nonnegative().max(maximum).default(0),
    })
    .superRefine((configuration, context) => {
      if (configuration.minLength > configuration.maxLength) {
        context.addIssue({
          code: "custom",
          message: "Minimum length must not exceed maximum length.",
        });
      }
    });
}

const numericFieldConfigurationSchema = z
  .strictObject({
    max: z.number().finite().optional(),
    min: z.number().finite().optional(),
  })
  .superRefine((configuration, context) => {
    if (
      configuration.min !== undefined &&
      configuration.max !== undefined &&
      configuration.min > configuration.max
    ) {
      context.addIssue({ code: "custom", message: "Minimum value must not exceed maximum value." });
    }
  });

const selectionOptionsSchema = z
  .array(z.string().min(1).max(120))
  .min(1)
  .max(200)
  .superRefine((options, context) => {
    if (new Set(options).size !== options.length) {
      context.addIssue({ code: "custom", message: "Selection options must be unique." });
    }
  });

const selectFieldConfigurationSchema = z.strictObject({
  options: selectionOptionsSchema,
});

const multiSelectFieldConfigurationSchema = z.strictObject({
  maxItems: z.number().int().positive().max(100).default(20),
  options: selectionOptionsSchema,
});

const collectionFieldConfigurationSchema = z.strictObject({
  maxItems: z.number().int().positive().max(100).default(20),
});

const relationFieldConfigurationSchema = z.strictObject({
  maxItems: z.number().int().positive().max(100).default(20),
  multiple: z.boolean().default(false),
});

const emptyFieldConfigurationSchema = z.strictObject({});

export const fieldConfigurationSchemas = Object.freeze({
  boolean: emptyFieldConfigurationSchema,
  color: emptyFieldConfigurationSchema,
  date: emptyFieldConfigurationSchema,
  datetime: emptyFieldConfigurationSchema,
  decimal: numericFieldConfigurationSchema,
  email: boundedLengthConfiguration(254),
  gallery: collectionFieldConfigurationSchema,
  integer: numericFieldConfigurationSchema,
  json: emptyFieldConfigurationSchema,
  media: emptyFieldConfigurationSchema,
  multiSelect: multiSelectFieldConfigurationSchema,
  relation: relationFieldConfigurationSchema,
  richText: boundedLengthConfiguration(500_000),
  select: selectFieldConfigurationSchema,
  taxonomy: collectionFieldConfigurationSchema,
  text: boundedLengthConfiguration(10_000),
  textarea: boundedLengthConfiguration(100_000),
  url: boundedLengthConfiguration(2_048),
} satisfies Record<InitialFieldType, z.ZodType>);

export const fieldDefinitionSchema = z
  .strictObject({
    key: fieldDefinitionKeySchema,
    label: z.string().trim().min(1).max(120),
    fieldType: fieldTypeSchema,
    required: z.boolean().default(false),
    position: z.number().int().nonnegative().default(0),
    config: contentLocaleDataSchema.default({}),
  })
  .superRefine((field, context) => {
    const result = fieldConfigurationSchemas[field.fieldType].safeParse(field.config);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: "Configuration does not match the field type.",
        path: ["config"],
      });
    }
  });

const contentTypeFieldsSchema = z
  .array(fieldDefinitionSchema)
  .max(100)
  .superRefine((fields, context) => {
    const seenKeys = new Set<string>();
    for (const [index, field] of fields.entries()) {
      if (seenKeys.has(field.key)) {
        context.addIssue({
          code: "custom",
          message: "Field keys must be unique within a content type.",
          path: [index, "key"],
        });
      }
      seenKeys.add(field.key);
    }
  });

export const contentTypeCreateSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  fields: contentTypeFieldsSchema,
  key: contentTypeKeySchema,
});

export const contentTypeUpdateSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  fields: contentTypeFieldsSchema,
});

export const contentTypeSchemaDefinitionSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  fields: contentTypeFieldsSchema,
  key: contentTypeKeySchema,
  version: contentSchemaVersionSchema,
});

const contentLocaleWriteSchema = z.strictObject({
  data: contentLocaleDataSchema,
  localeId: z.string().uuid(),
});

const contentLocaleWritesSchema = z
  .array(contentLocaleWriteSchema)
  .min(1)
  .max(20)
  .superRefine((locales, context) => {
    const seenLocaleIds = new Set<string>();
    for (const [index, locale] of locales.entries()) {
      if (seenLocaleIds.has(locale.localeId)) {
        context.addIssue({
          code: "custom",
          message: "Each locale may occur only once per entry.",
          path: [index, "localeId"],
        });
      }
      seenLocaleIds.add(locale.localeId);
    }
  });

export const contentEntryCreateSchema = z.strictObject({
  contentTypeId: z.string().uuid(),
  locales: contentLocaleWritesSchema,
});

export const contentEntryUpdateSchema = z.strictObject({
  locales: contentLocaleWritesSchema,
});

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type ContentTypeCreateInput = z.infer<typeof contentTypeCreateSchema>;
export type ContentTypeUpdateInput = z.infer<typeof contentTypeUpdateSchema>;
export type ContentEntryCreateInput = z.infer<typeof contentEntryCreateSchema>;
export type ContentEntryUpdateInput = z.infer<typeof contentEntryUpdateSchema>;
