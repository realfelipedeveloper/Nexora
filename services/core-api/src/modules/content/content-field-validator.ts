import { Injectable } from "@nestjs/common";
import {
  contentTypeSchemaDefinitionSchema,
  fieldConfigurationSchemas,
  type FieldDefinition,
} from "@nexora/schemas";

export const maximumContentBytes = 1_048_576;
const maximumJsonDepth = 32;

export type ContentValidationIssueCode =
  | "invalid_format"
  | "invalid_json"
  | "invalid_schema"
  | "invalid_type"
  | "invalid_value"
  | "required"
  | "unknown_fields";

export type ContentValidationIssue = {
  code: ContentValidationIssueCode;
  fieldKey?: string;
  message: string;
};

export class ContentSchemaInvalidError extends Error {
  override readonly name = "ContentSchemaInvalidError";

  constructor(readonly issues: readonly ContentValidationIssue[]) {
    super("Content schema definition is invalid.");
  }
}

export class ContentDataInvalidError extends Error {
  override readonly name = "ContentDataInvalidError";

  constructor(readonly issues: readonly ContentValidationIssue[]) {
    super("Content data is invalid.");
  }
}

export class ContentDataTooLargeError extends Error {
  override readonly name = "ContentDataTooLargeError";

  constructor(readonly maximumBytes = maximumContentBytes) {
    super("Content data exceeds the supported size.");
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > maximumJsonDepth) {
    return false;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

function encodedSize(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError("Value is not JSON serializable.");
    }
    return Buffer.byteLength(encoded, "utf8");
  } catch {
    throw new ContentDataInvalidError([
      { code: "invalid_json", message: "Content must be JSON serializable." },
    ]);
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validDatetime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function validHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function readNumber(configuration: JsonRecord, key: string): number | undefined {
  const value = configuration[key];
  return typeof value === "number" ? value : undefined;
}

function issue(field: FieldDefinition, code: ContentValidationIssueCode): ContentValidationIssue {
  return {
    code,
    fieldKey: field.key,
    message: "Value does not match the configured field type.",
  };
}

function validateString(
  field: FieldDefinition,
  value: unknown,
  configuration: JsonRecord,
): ContentValidationIssue | undefined {
  if (typeof value !== "string") {
    return issue(field, "invalid_type");
  }
  const minimum = readNumber(configuration, "minLength") ?? 0;
  const maximum = readNumber(configuration, "maxLength") ?? Number.MAX_SAFE_INTEGER;
  if (value.length < minimum || value.length > maximum) {
    return issue(field, "invalid_value");
  }
  return undefined;
}

function validateNumber(
  field: FieldDefinition,
  value: unknown,
  configuration: JsonRecord,
  integer: boolean,
): ContentValidationIssue | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value))
  ) {
    return issue(field, "invalid_type");
  }
  const minimum = readNumber(configuration, "min");
  const maximum = readNumber(configuration, "max");
  if ((minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
    return issue(field, "invalid_value");
  }
  return undefined;
}

function validateReferences(
  field: FieldDefinition,
  value: unknown,
  maximumItems: number,
): ContentValidationIssue | undefined {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    new Set(value).size !== value.length ||
    !value.every(validUuid)
  ) {
    return issue(field, "invalid_value");
  }
  return undefined;
}

function validateFieldValue(
  field: FieldDefinition,
  value: unknown,
): ContentValidationIssue | undefined {
  const configuration = fieldConfigurationSchemas[field.fieldType].parse(
    field.config,
  ) as JsonRecord;

  switch (field.fieldType) {
    case "text":
    case "textarea":
    case "richText":
      return validateString(field, value, configuration);
    case "integer":
      return validateNumber(field, value, configuration, true);
    case "decimal":
      return validateNumber(field, value, configuration, false);
    case "boolean":
      return typeof value === "boolean" ? undefined : issue(field, "invalid_type");
    case "date":
      return typeof value === "string" && validDate(value)
        ? undefined
        : issue(field, "invalid_format");
    case "datetime":
      return typeof value === "string" && validDatetime(value)
        ? undefined
        : issue(field, "invalid_format");
    case "select": {
      const options = configuration.options as string[];
      return typeof value === "string" && options.includes(value)
        ? undefined
        : issue(field, "invalid_value");
    }
    case "multiSelect": {
      const options = configuration.options as string[];
      const maximumItems = configuration.maxItems as number;
      return Array.isArray(value) &&
        value.length <= maximumItems &&
        new Set(value).size === value.length &&
        value.every((item) => typeof item === "string" && options.includes(item))
        ? undefined
        : issue(field, "invalid_value");
    }
    case "media":
      return validUuid(value) ? undefined : issue(field, "invalid_format");
    case "gallery":
    case "taxonomy":
      return validateReferences(field, value, configuration.maxItems as number);
    case "relation":
      return configuration.multiple === true
        ? validateReferences(field, value, configuration.maxItems as number)
        : validUuid(value)
          ? undefined
          : issue(field, "invalid_format");
    case "url": {
      const stringIssue = validateString(field, value, configuration);
      return (
        stringIssue ?? (validHttpUrl(value as string) ? undefined : issue(field, "invalid_format"))
      );
    }
    case "email": {
      const stringIssue = validateString(field, value, configuration);
      return (
        stringIssue ?? (validEmail(value as string) ? undefined : issue(field, "invalid_format"))
      );
    }
    case "color":
      return typeof value === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value)
        ? undefined
        : issue(field, "invalid_format");
    case "json":
      return isJsonValue(value) ? undefined : issue(field, "invalid_json");
    default:
      return field.fieldType satisfies never;
  }
}

@Injectable()
export class ContentFieldValidator {
  validate(definition: unknown, data: unknown): Readonly<JsonRecord> {
    const parsedDefinition = contentTypeSchemaDefinitionSchema.safeParse(definition);
    if (!parsedDefinition.success) {
      throw new ContentSchemaInvalidError(
        parsedDefinition.error.issues.map(() => ({
          code: "invalid_schema",
          message: "Schema definition does not match the supported contract.",
        })),
      );
    }

    if (encodedSize(data) > maximumContentBytes) {
      throw new ContentDataTooLargeError();
    }
    if (!isRecord(data) || !isJsonValue(data)) {
      throw new ContentDataInvalidError([
        { code: "invalid_json", message: "Content must be a JSON object." },
      ]);
    }

    const issues: ContentValidationIssue[] = [];
    const fieldKeys = new Set(parsedDefinition.data.fields.map((field) => field.key));
    if (Object.keys(data).some((key) => !fieldKeys.has(key))) {
      issues.push({
        code: "unknown_fields",
        message: "Content contains fields outside the schema.",
      });
    }

    for (const field of parsedDefinition.data.fields) {
      const present = Object.prototype.hasOwnProperty.call(data, field.key);
      const value = data[field.key];
      if (!present || value === null) {
        if (field.required) {
          issues.push({ code: "required", fieldKey: field.key, message: "Field is required." });
        }
        continue;
      }
      if (
        field.required &&
        ((typeof value === "string" && value.trim() === "") ||
          (Array.isArray(value) && value.length === 0))
      ) {
        issues.push({ code: "required", fieldKey: field.key, message: "Field is required." });
        continue;
      }

      const fieldIssue = validateFieldValue(field, value);
      if (fieldIssue) {
        issues.push(fieldIssue);
      }
    }

    if (issues.length > 0) {
      throw new ContentDataInvalidError(issues);
    }

    return Object.freeze({ ...data });
  }
}
