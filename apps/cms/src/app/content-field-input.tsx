"use client";

import type { FieldDefinition } from "./editorial-api";
import { type ReactNode, useEffect, useState } from "react";

type Props = {
  disabled: boolean;
  field: FieldDefinition;
  onChange: (value: unknown) => void;
  value: unknown;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function options(field: FieldDefinition) {
  return Array.isArray(field.config.options)
    ? field.config.options.filter((value): value is string => typeof value === "string")
    : [];
}

function datetimeLocalValue(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ContentFieldInput({ disabled, field, onChange, value }: Props) {
  const id = `entry-field-${field.key}`;
  const label = (
    <>
      {field.label}
      {field.required ? <span aria-hidden="true"> *</span> : null}
    </>
  );

  if (field.fieldType === "boolean") {
    return (
      <label className="checkbox-label entry-checkbox" htmlFor={id}>
        <input
          checked={value === true}
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        {label}
      </label>
    );
  }

  if (field.fieldType === "select") {
    return (
      <label htmlFor={id}>
        {label}
        <select
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.value || undefined)}
          required={field.required}
          value={textValue(value)}
        >
          <option value="">Select an option</option>
          {options(field).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.fieldType === "multiSelect") {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    return (
      <label htmlFor={id}>
        {label}
        <select
          disabled={disabled}
          id={id}
          multiple
          onChange={(event) =>
            onChange(Array.from(event.target.selectedOptions, (option) => option.value))
          }
          required={field.required}
          value={selected}
        >
          {options(field).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.fieldType === "integer" || field.fieldType === "decimal") {
    return (
      <label htmlFor={id}>
        {label}
        <input
          disabled={disabled}
          id={id}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
          required={field.required}
          step={field.fieldType === "integer" ? 1 : "any"}
          type="number"
          value={typeof value === "number" ? value : ""}
        />
      </label>
    );
  }

  if (field.fieldType === "date" || field.fieldType === "datetime") {
    return (
      <label htmlFor={id}>
        {label}
        <input
          disabled={disabled}
          id={id}
          onChange={(event) =>
            onChange(
              !event.target.value
                ? undefined
                : field.fieldType === "datetime"
                  ? new Date(event.target.value).toISOString()
                  : event.target.value,
            )
          }
          required={field.required}
          type={field.fieldType === "date" ? "date" : "datetime-local"}
          value={field.fieldType === "datetime" ? datetimeLocalValue(value) : textValue(value)}
        />
      </label>
    );
  }

  if (field.fieldType === "textarea" || field.fieldType === "richText") {
    return (
      <label className="wide-field" htmlFor={id}>
        {label}
        <textarea
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
          rows={field.fieldType === "richText" ? 10 : 5}
          value={textValue(value)}
        />
      </label>
    );
  }

  if (["gallery", "json", "media", "relation", "taxonomy"].includes(field.fieldType)) {
    return (
      <JsonField
        disabled={disabled}
        field={field}
        id={id}
        label={label}
        onChange={onChange}
        value={value}
      />
    );
  }

  const type =
    field.fieldType === "email"
      ? "email"
      : field.fieldType === "url"
        ? "url"
        : field.fieldType === "color"
          ? "color"
          : "text";
  return (
    <label htmlFor={id}>
      {label}
      <input
        disabled={disabled}
        id={id}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(
            nextValue === "" && ["color", "email", "url"].includes(field.fieldType)
              ? undefined
              : nextValue,
          );
        }}
        required={field.required}
        type={type}
        value={textValue(value)}
      />
    </label>
  );
}

function JsonField({
  disabled,
  field,
  id,
  label,
  onChange,
  value,
}: Props & { id: string; label: ReactNode }) {
  const serialized = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized);
  useEffect(() => setDraft(serialized), [serialized]);

  return (
    <label className="wide-field" htmlFor={id}>
      {label}
      <span className="label-hint">JSON value</span>
      <textarea
        disabled={disabled}
        id={id}
        onBlur={(event) => {
          if (!event.target.value.trim()) {
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(event.target.value));
          } catch {
            event.target.setCustomValidity("Enter valid JSON.");
            event.target.reportValidity();
          }
        }}
        onChange={(event) => {
          event.target.setCustomValidity("");
          setDraft(event.target.value);
        }}
        required={field.required}
        rows={5}
        value={draft}
      />
    </label>
  );
}
