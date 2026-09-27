"use client";

import {
  ArrowDown,
  ArrowUp,
  Braces,
  CircleAlert,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { initialFieldTypes, type InitialFieldType } from "@nexora/schemas";
import { type FormEvent, useEffect, useState } from "react";
import {
  deleteContentType,
  editorialErrorMessage,
  getContentType,
  listContentTypes,
  saveContentType,
  type ContentTypeDetail,
  type ContentTypeSummary,
  type FieldDefinition,
} from "./editorial-api";

type Props = { canWrite: boolean; csrfToken: string; siteId: string };
type Editor = { contentType: ContentTypeDetail; version?: number };

function emptyContentType(): ContentTypeDetail {
  return {
    displayName: "",
    fields: [],
    id: "",
    key: "",
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
  };
}

function fieldConfig(fieldType: InitialFieldType) {
  return fieldType === "select" || fieldType === "multiSelect" ? { options: ["Option"] } : {};
}

function newField(fields: FieldDefinition[]): FieldDefinition {
  let sequence = fields.length + 1;
  while (fields.some((field) => field.key === `field-${sequence}`)) sequence += 1;
  return {
    config: {},
    fieldType: "text",
    key: `field-${sequence}`,
    label: `Field ${sequence}`,
    position: fields.length,
    required: false,
  };
}

export function ContentTypesView({ canWrite, csrfToken, siteId }: Props) {
  const [items, setItems] = useState<ContentTypeSummary[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function loadList() {
    setItems(null);
    setError("");
    void listContentTypes(siteId)
      .then((page) => setItems(page.items))
      .catch((reason: unknown) => setError(editorialErrorMessage(reason)));
  }

  useEffect(loadList, [siteId]);

  function openType(contentTypeId: string) {
    setLoadingEditor(true);
    setMessage("");
    setError("");
    void getContentType(siteId, contentTypeId)
      .then(({ value, version }) => setEditor({ contentType: value, version }))
      .catch((reason: unknown) => setError(editorialErrorMessage(reason)))
      .finally(() => setLoadingEditor(false));
  }

  function updateContentType(change: Partial<ContentTypeDetail>) {
    setEditor((current) =>
      current ? { ...current, contentType: { ...current.contentType, ...change } } : current,
    );
  }

  function updateField(index: number, change: Partial<FieldDefinition>) {
    if (!editor) return;
    const fields = editor.contentType.fields.map((field, fieldIndex) =>
      fieldIndex === index ? { ...field, ...change } : field,
    );
    updateContentType({ fields });
  }

  function moveField(index: number, offset: -1 | 1) {
    if (!editor) return;
    const target = index + offset;
    if (target < 0 || target >= editor.contentType.fields.length) return;
    const fields = [...editor.contentType.fields];
    const field = fields[index];
    const other = fields[target];
    if (!field || !other) return;
    fields[index] = other;
    fields[target] = field;
    updateContentType({ fields: fields.map((item, position) => ({ ...item, position })) });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !canWrite) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await saveContentType(
        csrfToken,
        siteId,
        {
          displayName: editor.contentType.displayName.trim(),
          fields: editor.contentType.fields,
          key: editor.contentType.key.trim(),
        },
        editor.contentType.id && editor.version
          ? { id: editor.contentType.id, version: editor.version }
          : undefined,
      );
      setEditor({ contentType: result.value, version: result.version });
      setMessage(editor.contentType.id ? "Content type updated." : "Content type created.");
      loadList();
    } catch (reason) {
      setError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editor?.contentType.id || !editor.version || !canWrite) return;
    if (!window.confirm(`Delete “${editor.contentType.displayName}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteContentType(csrfToken, siteId, editor.contentType.id, editor.version);
      setEditor(null);
      setMessage("Content type deleted.");
      loadList();
    } catch (reason) {
      setError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="editorial-page" aria-labelledby="content-types-title">
      <header className="page-toolbar">
        <div>
          <p className="eyebrow">Content modeling</p>
          <h2 id="content-types-title">Content types</h2>
        </div>
        {canWrite ? (
          <button
            className="button button-primary"
            onClick={() => {
              setEditor({ contentType: emptyContentType() });
              setError("");
              setMessage("");
            }}
            type="button"
          >
            <Plus aria-hidden="true" /> New type
          </button>
        ) : null}
      </header>

      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {message ? (
        <p className="success-notice" role="status">
          {message}
        </p>
      ) : null}

      <div className="master-detail-layout">
        <section className="resource-list" aria-label="Content types">
          {items === null ? <LoadingLabel>Loading content types</LoadingLabel> : null}
          {items?.length === 0 ? <p className="empty-state">No content types yet.</p> : null}
          {items?.map((item) => (
            <button
              aria-current={editor?.contentType.id === item.id ? "true" : undefined}
              className="resource-row"
              key={item.id}
              onClick={() => openType(item.id)}
              type="button"
            >
              <Braces aria-hidden="true" size={18} />
              <span>
                <strong>{item.displayName}</strong>
                <small>{item.key}</small>
              </span>
              <span className="version-label">v{item.schemaVersion}</span>
            </button>
          ))}
          {items ? (
            <button className="text-button" onClick={loadList} type="button">
              <RefreshCw aria-hidden="true" size={16} /> Refresh
            </button>
          ) : null}
        </section>

        <section className="detail-panel" aria-label="Content type editor">
          {loadingEditor ? <LoadingLabel>Loading content type</LoadingLabel> : null}
          {!loadingEditor && !editor ? (
            <div className="blank-state">
              <Braces aria-hidden="true" />
              <h3>Select a content type</h3>
              <p>Review its fields or create a new model.</p>
            </div>
          ) : null}
          {!loadingEditor && editor ? (
            <form className="editor-form" onSubmit={(event) => void submit(event)}>
              <div className="form-grid two-columns">
                <label>
                  Display name
                  <input
                    disabled={!canWrite}
                    maxLength={120}
                    onChange={(event) => updateContentType({ displayName: event.target.value })}
                    required
                    value={editor.contentType.displayName}
                  />
                </label>
                <label>
                  API key
                  <input
                    disabled={!canWrite || Boolean(editor.contentType.id)}
                    maxLength={63}
                    onChange={(event) => updateContentType({ key: event.target.value })}
                    pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                    required
                    value={editor.contentType.key}
                  />
                </label>
              </div>

              <div className="subsection-heading">
                <div>
                  <h3>Fields</h3>
                  <p>Order and configure the data editors for this type.</p>
                </div>
                {canWrite ? (
                  <button
                    className="button button-secondary compact-button"
                    onClick={() =>
                      updateContentType({
                        fields: [...editor.contentType.fields, newField(editor.contentType.fields)],
                      })
                    }
                    type="button"
                  >
                    <Plus aria-hidden="true" /> Add field
                  </button>
                ) : null}
              </div>

              <div className="field-editor-list">
                {editor.contentType.fields.length === 0 ? (
                  <p className="empty-state">Add the first field to this model.</p>
                ) : null}
                {editor.contentType.fields.map((field, index) => (
                  <fieldset className="field-editor" key={`${field.id ?? "new"}-${index}`}>
                    <legend>Field {index + 1}</legend>
                    <div className="field-actions">
                      <button
                        aria-label={`Move ${field.label} up`}
                        className="icon-button"
                        disabled={!canWrite || index === 0}
                        onClick={() => moveField(index, -1)}
                        title="Move up"
                        type="button"
                      >
                        <ArrowUp aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Move ${field.label} down`}
                        className="icon-button"
                        disabled={!canWrite || index === editor.contentType.fields.length - 1}
                        onClick={() => moveField(index, 1)}
                        title="Move down"
                        type="button"
                      >
                        <ArrowDown aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Remove ${field.label}`}
                        className="icon-button danger-button"
                        disabled={!canWrite}
                        onClick={() =>
                          updateContentType({
                            fields: editor.contentType.fields
                              .filter((_, fieldIndex) => fieldIndex !== index)
                              .map((item, position) => ({ ...item, position })),
                          })
                        }
                        title="Remove field"
                        type="button"
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                    <div className="form-grid field-definition-grid">
                      <label>
                        Label
                        <input
                          disabled={!canWrite}
                          maxLength={120}
                          onChange={(event) => updateField(index, { label: event.target.value })}
                          required
                          value={field.label}
                        />
                      </label>
                      <label>
                        Key
                        <input
                          disabled={!canWrite}
                          maxLength={63}
                          onChange={(event) => updateField(index, { key: event.target.value })}
                          pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                          required
                          value={field.key}
                        />
                      </label>
                      <label>
                        Type
                        <select
                          disabled={!canWrite}
                          onChange={(event) => {
                            const fieldType = event.target.value as InitialFieldType;
                            updateField(index, { config: fieldConfig(fieldType), fieldType });
                          }}
                          value={field.fieldType}
                        >
                          {initialFieldTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          checked={field.required}
                          disabled={!canWrite}
                          onChange={(event) =>
                            updateField(index, { required: event.target.checked })
                          }
                          type="checkbox"
                        />{" "}
                        Required
                      </label>
                    </div>
                    {field.fieldType === "select" || field.fieldType === "multiSelect" ? (
                      <label>
                        Options <span className="label-hint">One per line</span>
                        <textarea
                          disabled={!canWrite}
                          onChange={(event) =>
                            updateField(index, {
                              config: {
                                ...field.config,
                                options: event.target.value
                                  .split("\n")
                                  .map((option) => option.trim())
                                  .filter(Boolean),
                              },
                            })
                          }
                          required
                          value={
                            Array.isArray(field.config.options)
                              ? field.config.options.join("\n")
                              : ""
                          }
                        />
                      </label>
                    ) : null}
                  </fieldset>
                ))}
              </div>

              {canWrite ? (
                <footer className="form-actions">
                  {editor.contentType.id ? (
                    <button
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => void remove()}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" /> Delete
                    </button>
                  ) : null}
                  <button className="button button-primary" disabled={busy}>
                    <Save aria-hidden="true" /> {busy ? "Saving" : "Save type"}
                  </button>
                </footer>
              ) : null}
            </form>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function LoadingLabel({ children }: { children: string }) {
  return (
    <p className="loading-label" aria-live="polite">
      <LoaderCircle aria-hidden="true" className="spin" size={18} /> {children}
    </p>
  );
}

function InlineAlert({ children }: { children: string }) {
  return (
    <p className="inline-alert" role="alert">
      <CircleAlert aria-hidden="true" size={18} /> {children}
    </p>
  );
}
