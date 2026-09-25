"use client";

import {
  Archive,
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  FileClock,
  FilePlus2,
  Files,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type { ContentEntryStatus } from "@nexora/schemas";
import { type FormEvent, useEffect, useState } from "react";
import { ContentFieldInput } from "./content-field-input";
import {
  addAssignment,
  addComment,
  addReview,
  changeEntryStatus,
  compareRevisions,
  deleteContentEntry,
  editorialErrorMessage,
  getContentEntry,
  getContentType,
  listAssignments,
  listComments,
  listContentEntries,
  listContentTypes,
  listReviews,
  listRevisions,
  listTransitions,
  removeAssignment,
  restoreRevision,
  saveContentEntry,
  type Assignment,
  type ContentEntryDetail,
  type ContentEntrySummary,
  type ContentRevision,
  type ContentTypeDetail,
  type ContentTypeSummary,
  type EditorialComment,
  type EditorialContext,
  type EditorialReview,
  type EditorialTransition,
  type RevisionComparison,
} from "./editorial-api";

type Props = {
  canPublish: boolean;
  canWrite: boolean;
  context: EditorialContext;
  csrfToken: string;
  siteId: string;
};
type LocaleDraft = { code: string; data: Record<string, unknown>; localeId: string };
type EditorState = {
  entry?: ContentEntryDetail;
  locales: LocaleDraft[];
  revision?: number;
  type: ContentTypeDetail;
};
type DetailTab = "content" | "workflow" | "revisions";

const statusLabels: Record<ContentEntryStatus, string> = {
  ARCHIVED: "Archived",
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  PUBLISHED: "Published",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function EntriesView({ canPublish, canWrite, context, csrfToken, siteId }: Props) {
  const [types, setTypes] = useState<ContentTypeSummary[] | null>(null);
  const [entries, setEntries] = useState<ContentEntrySummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [error, setError] = useState("");

  function loadTypes() {
    void listContentTypes(siteId)
      .then((page) => setTypes(page.items))
      .catch((reason: unknown) => setError(editorialErrorMessage(reason)));
  }

  function loadEntries() {
    setEntries(null);
    setError("");
    void listContentEntries(siteId, filter || undefined)
      .then((page) => setEntries(page.items))
      .catch((reason: unknown) => setError(editorialErrorMessage(reason)));
  }

  useEffect(loadTypes, [siteId]);
  useEffect(loadEntries, [filter, siteId]);

  return (
    <section className="editorial-page" aria-labelledby="entries-title">
      <header className="page-toolbar">
        <div>
          <p className="eyebrow">Editorial workspace</p>
          <h2 id="entries-title">Entries</h2>
        </div>
        {canWrite && types?.length ? (
          <button
            className="button button-primary"
            onClick={() => setSelectedId("new")}
            type="button"
          >
            <FilePlus2 aria-hidden="true" /> New entry
          </button>
        ) : null}
      </header>
      {error ? <InlineAlert>{error}</InlineAlert> : null}

      <div className="entry-filter-bar">
        <label htmlFor="entry-type-filter">Content type</label>
        <select
          id="entry-type-filter"
          onChange={(event) => setFilter(event.target.value)}
          value={filter}
        >
          <option value="">All types</option>
          {types?.map((type) => (
            <option key={type.id} value={type.id}>
              {type.displayName}
            </option>
          ))}
        </select>
        <button
          aria-label="Refresh entries"
          className="icon-button"
          onClick={loadEntries}
          title="Refresh entries"
          type="button"
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>

      <div className="master-detail-layout entries-layout">
        <section className="resource-list" aria-label="Content entries">
          {entries === null ? <LoadingLabel>Loading entries</LoadingLabel> : null}
          {entries?.length === 0 ? (
            <p className="empty-state">No entries match this view.</p>
          ) : null}
          {entries?.map((entry) => (
            <button
              aria-current={selectedId === entry.id ? "true" : undefined}
              className="resource-row entry-row"
              key={entry.id}
              onClick={() => setSelectedId(entry.id)}
              type="button"
            >
              <Files aria-hidden="true" size={18} />
              <span>
                <strong>{entry.contentType.displayName}</strong>
                <small>
                  {entry.id.slice(0, 8)} · r{entry.revision}
                </small>
              </span>
              <StatusBadge status={entry.status} />
            </button>
          ))}
        </section>

        <section className="detail-panel entry-detail-panel" aria-label="Entry editor">
          {selectedId ? (
            <EntryEditor
              canPublish={canPublish}
              canWrite={canWrite}
              context={context}
              csrfToken={csrfToken}
              entryId={selectedId}
              onClose={() => setSelectedId(null)}
              onMutated={loadEntries}
              siteId={siteId}
              types={types ?? []}
            />
          ) : (
            <div className="blank-state">
              <Files aria-hidden="true" />
              <h3>Select an entry</h3>
              <p>Edit content, move it through workflow, or inspect its history.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function EntryEditor({
  canPublish,
  canWrite,
  context,
  csrfToken,
  entryId,
  onClose,
  onMutated,
  siteId,
  types,
}: Props & {
  entryId: string | "new";
  onClose: () => void;
  onMutated: () => void;
  types: ContentTypeSummary[];
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [activeLocale, setActiveLocale] = useState("");
  const [tab, setTab] = useState<DetailTab>("content");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function loadExisting(id: string) {
    setEditor(null);
    setError("");
    void getContentEntry(siteId, id)
      .then(async ({ value, version }) => {
        const type = await getContentType(siteId, value.contentTypeId);
        const locales = value.contentLocales.map((locale) => ({
          code: locale.locale.code,
          data: locale.data,
          localeId: locale.localeId,
        }));
        setEditor({ entry: value, locales, revision: version, type: type.value });
        setActiveLocale(locales[0]?.localeId ?? "");
      })
      .catch((reason: unknown) => setError(editorialErrorMessage(reason)));
  }

  function startNew(contentTypeId: string) {
    setEditor(null);
    setError("");
    void getContentType(siteId, contentTypeId)
      .then(({ value }) => {
        const locale = context.locales[0];
        setEditor({
          locales: locale ? [{ code: locale.code, data: {}, localeId: locale.id }] : [],
          type: value,
        });
        setActiveLocale(locale?.id ?? "");
      })
      .catch((reason: unknown) => setError(editorialErrorMessage(reason)));
  }

  useEffect(() => {
    setTab("content");
    setMessage("");
    if (entryId === "new") {
      const firstType = types[0];
      if (firstType) startNew(firstType.id);
      else setEditor(null);
    } else {
      loadExisting(entryId);
    }
  }, [entryId, siteId]);

  const active = editor?.locales.find((locale) => locale.localeId === activeLocale);
  const unusedLocales = context.locales.filter(
    (locale) => !editor?.locales.some((draft) => draft.localeId === locale.id),
  );
  const editable = Boolean(canWrite && (!editor?.entry || editor.entry.status === "DRAFT"));

  function updateValue(key: string, value: unknown) {
    if (!editor) return;
    setEditor({
      ...editor,
      locales: editor.locales.map((locale) =>
        locale.localeId === activeLocale
          ? {
              ...locale,
              data:
                value === undefined
                  ? Object.fromEntries(
                      Object.entries(locale.data).filter(([fieldKey]) => fieldKey !== key),
                    )
                  : { ...locale.data, [key]: value },
            }
          : locale,
      ),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !editable) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await saveContentEntry(
        csrfToken,
        siteId,
        {
          contentTypeId: editor.type.id,
          locales: editor.locales.map(({ data, localeId }) => ({ data, localeId })),
        },
        editor.entry && editor.revision
          ? { id: editor.entry.id, revision: editor.revision }
          : undefined,
      );
      setEditor({ ...editor, entry: result.value, revision: result.version });
      setMessage(editor.entry ? "Entry saved." : "Entry created.");
      onMutated();
    } catch (reason) {
      setError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editor?.entry || !editor.revision || !canWrite) return;
    if (!window.confirm("Delete this content entry?")) return;
    setBusy(true);
    setError("");
    try {
      await deleteContentEntry(csrfToken, siteId, editor.entry.id, editor.revision);
      onMutated();
      onClose();
    } catch (reason) {
      setError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function refreshed(entry: ContentEntryDetail, revision: number, notice: string) {
    setEditor((current) =>
      current
        ? {
            ...current,
            entry,
            locales: entry.contentLocales.map((locale) => ({
              code: locale.locale.code,
              data: locale.data,
              localeId: locale.localeId,
            })),
            revision,
          }
        : current,
    );
    setMessage(notice);
    onMutated();
  }

  return (
    <div className="entry-editor">
      <header className="detail-header">
        <button
          aria-label="Close entry"
          className="icon-button detail-back"
          onClick={onClose}
          title="Close entry"
          type="button"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <h3>{editor?.entry ? editor.type.displayName : "New entry"}</h3>
          {editor?.entry ? (
            <p>
              {editor.entry.id} · revision {editor.entry.revision}
            </p>
          ) : (
            <p>Create a draft.</p>
          )}
        </div>
        {editor?.entry ? <StatusBadge status={editor.entry.status} /> : null}
      </header>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {message ? (
        <p className="success-notice" role="status">
          {message}
        </p>
      ) : null}
      {!editor ? <LoadingLabel>Loading entry</LoadingLabel> : null}
      {editor ? (
        <>
          <div className="detail-tabs" role="tablist" aria-label="Entry details">
            {(["content", "workflow", "revisions"] as const).map((item) => (
              <button
                aria-selected={tab === item}
                className={tab === item ? "detail-tab detail-tab-active" : "detail-tab"}
                key={item}
                onClick={() => setTab(item)}
                role="tab"
                type="button"
              >
                {item === "content" ? "Content" : item === "workflow" ? "Workflow" : "Revisions"}
              </button>
            ))}
          </div>
          {tab === "content" ? (
            <form className="editor-form entry-content-form" onSubmit={(event) => void save(event)}>
              {!editor.entry ? (
                <label>
                  Content type
                  <select onChange={(event) => startNew(event.target.value)} value={editor.type.id}>
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="locale-toolbar">
                <div className="locale-tabs" role="tablist" aria-label="Entry locales">
                  {editor.locales.map((locale) => (
                    <button
                      aria-selected={activeLocale === locale.localeId}
                      className={
                        activeLocale === locale.localeId
                          ? "locale-tab locale-tab-active"
                          : "locale-tab"
                      }
                      key={locale.localeId}
                      onClick={() => setActiveLocale(locale.localeId)}
                      role="tab"
                      type="button"
                    >
                      {locale.code}
                    </button>
                  ))}
                </div>
                {editable && unusedLocales.length ? (
                  <select
                    aria-label="Add locale"
                    onChange={(event) => {
                      const locale = context.locales.find((item) => item.id === event.target.value);
                      if (locale) {
                        setEditor({
                          ...editor,
                          locales: [
                            ...editor.locales,
                            { code: locale.code, data: {}, localeId: locale.id },
                          ],
                        });
                        setActiveLocale(locale.id);
                      }
                    }}
                    value=""
                  >
                    <option value="">Add locale…</option>
                    {unusedLocales.map((locale) => (
                      <option key={locale.id} value={locale.id}>
                        {locale.code}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {active ? (
                <div className="entry-fields">
                  {editor.type.fields.map((field) => (
                    <ContentFieldInput
                      disabled={!editable}
                      field={field}
                      key={field.key}
                      onChange={(value) => updateValue(field.key, value)}
                      value={active.data[field.key]}
                    />
                  ))}
                </div>
              ) : (
                <p className="empty-state">This site has no locale available for content.</p>
              )}
              {editable ? (
                <footer className="form-actions">
                  {editor.entry ? (
                    <button
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => void remove()}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" /> Delete
                    </button>
                  ) : null}
                  <button className="button button-primary" disabled={busy || !active}>
                    <Save aria-hidden="true" /> {busy ? "Saving" : "Save draft"}
                  </button>
                </footer>
              ) : (
                <p className="read-only-notice">
                  Return this entry to draft before editing its fields.
                </p>
              )}
            </form>
          ) : null}
          {tab === "workflow" && editor.entry && editor.revision ? (
            <WorkflowPanel
              canPublish={canPublish}
              canWrite={canWrite}
              context={context}
              csrfToken={csrfToken}
              entry={editor.entry}
              onError={setError}
              onRefresh={(notice) => {
                if (entryId !== "new") loadExisting(entryId);
                setMessage(notice);
                onMutated();
              }}
              onVersioned={refreshed}
              revision={editor.revision}
              siteId={siteId}
            />
          ) : null}
          {tab === "revisions" && editor.entry && editor.revision ? (
            <RevisionsPanel
              canWrite={canWrite}
              csrfToken={csrfToken}
              entry={editor.entry}
              onError={setError}
              onVersioned={refreshed}
              revision={editor.revision}
              siteId={siteId}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function WorkflowPanel({
  canPublish,
  canWrite,
  context,
  csrfToken,
  entry,
  onError,
  onRefresh,
  onVersioned,
  revision,
  siteId,
}: {
  canPublish: boolean;
  canWrite: boolean;
  context: EditorialContext;
  csrfToken: string;
  entry: ContentEntryDetail;
  onError: (message: string) => void;
  onRefresh: (notice: string) => void;
  onVersioned: (entry: ContentEntryDetail, version: number, notice: string) => void;
  revision: number;
  siteId: string;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [comments, setComments] = useState<EditorialComment[]>([]);
  const [reviews, setReviews] = useState<EditorialReview[]>([]);
  const [transitions, setTransitions] = useState<EditorialTransition[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [comment, setComment] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    void Promise.all([
      listAssignments(siteId, entry.id),
      listComments(siteId, entry.id),
      listReviews(siteId, entry.id),
      listTransitions(siteId, entry.id),
    ])
      .then(([assignmentPage, commentPage, reviewPage, transitionPage]) => {
        setAssignments(assignmentPage.items);
        setComments(commentPage.items);
        setReviews(reviewPage.items);
        setTransitions(transitionPage.items);
      })
      .catch((reason: unknown) => onError(editorialErrorMessage(reason)));
  }
  useEffect(load, [entry.id, entry.revision, siteId]);

  async function transition(status: ContentEntryStatus, notice: string) {
    setBusy(true);
    onError("");
    try {
      const result = await changeEntryStatus(csrfToken, siteId, entry.id, revision, status);
      onVersioned(result.value, result.version, notice);
    } catch (reason) {
      onError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function review(decision: EditorialReview["decision"]) {
    setBusy(true);
    onError("");
    try {
      await addReview(
        csrfToken,
        siteId,
        entry.id,
        revision,
        decision,
        reviewNote.trim() || undefined,
      );
      onRefresh(decision === "APPROVED" ? "Revision approved." : "Changes requested.");
    } catch (reason) {
      onError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const approved = reviews.some(
    (item) => item.contentRevision === revision && item.decision === "APPROVED",
  );
  return (
    <div className="workflow-layout">
      <section className="workflow-section" aria-labelledby="workflow-actions-title">
        <div className="subsection-heading">
          <div>
            <h3 id="workflow-actions-title">Workflow</h3>
            <p>Move revision {revision} through its editorial lifecycle.</p>
          </div>
        </div>
        <div className="workflow-actions">
          {entry.status === "DRAFT" && canWrite ? (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void transition("IN_REVIEW", "Submitted for review.")}
              type="button"
            >
              <Send aria-hidden="true" /> Submit for review
            </button>
          ) : null}
          {entry.status === "IN_REVIEW" && canWrite ? (
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => void transition("DRAFT", "Returned to draft.")}
              type="button"
            >
              <RotateCcw aria-hidden="true" /> Return to draft
            </button>
          ) : null}
          {entry.status === "IN_REVIEW" && canPublish ? (
            <>
              <button
                className="button button-secondary"
                disabled={busy || approved}
                onClick={() => void review("APPROVED")}
                type="button"
              >
                <Check aria-hidden="true" /> Approve revision
              </button>
              <button
                className="button button-secondary"
                disabled={busy || !reviewNote.trim()}
                onClick={() => void review("CHANGES_REQUESTED")}
                type="button"
              >
                <X aria-hidden="true" /> Request changes
              </button>
              <textarea
                aria-label="Review note"
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="Review note"
                value={reviewNote}
              />
            </>
          ) : null}
          {entry.status === "IN_REVIEW" && canPublish && approved ? (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void transition("PUBLISHED", "Entry published.")}
              type="button"
            >
              <Check aria-hidden="true" /> Publish
            </button>
          ) : null}
          {entry.status === "PUBLISHED" && canPublish ? (
            <>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => void transition("DRAFT", "Entry unpublished.")}
                type="button"
              >
                <RotateCcw aria-hidden="true" /> Unpublish
              </button>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => void transition("ARCHIVED", "Entry archived.")}
                type="button"
              >
                <Archive aria-hidden="true" /> Archive
              </button>
            </>
          ) : null}
          {entry.status === "ARCHIVED" && canWrite ? (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void transition("DRAFT", "Entry restored to draft.")}
              type="button"
            >
              <RotateCcw aria-hidden="true" /> Restore draft
            </button>
          ) : null}
        </div>
      </section>

      <section className="workflow-section" aria-labelledby="assignments-title">
        <div className="subsection-heading">
          <div>
            <h3 id="assignments-title">Assignees</h3>
            <p>People responsible for this entry.</p>
          </div>
        </div>
        {canPublish ? (
          <div className="inline-form">
            <select
              aria-label="Assignee"
              onChange={(event) => setAssigneeId(event.target.value)}
              value={assigneeId}
            >
              <option value="">Select a member</option>
              {context.members
                .filter(
                  (member) =>
                    !assignments.some((assignment) => assignment.assignee.id === member.id),
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
            </select>
            <button
              aria-label="Assign member"
              className="icon-button bordered-icon"
              disabled={!assigneeId || busy}
              onClick={() => {
                setBusy(true);
                void addAssignment(csrfToken, siteId, entry.id, assigneeId)
                  .then(() => {
                    setAssigneeId("");
                    load();
                  })
                  .catch((reason: unknown) => onError(editorialErrorMessage(reason)))
                  .finally(() => setBusy(false));
              }}
              title="Assign member"
              type="button"
            >
              <UserPlus aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="compact-list">
          {assignments.map((assignment) => (
            <div className="compact-row" key={assignment.id}>
              <span>
                <strong>{assignment.assignee.displayName}</strong>
                <small>Assigned by {assignment.assignedBy.displayName}</small>
              </span>
              {canPublish ? (
                <button
                  aria-label={`Remove ${assignment.assignee.displayName}`}
                  className="icon-button danger-button"
                  onClick={() =>
                    void removeAssignment(csrfToken, siteId, entry.id, assignment.id)
                      .then(load)
                      .catch((reason: unknown) => onError(editorialErrorMessage(reason)))
                  }
                  title="Remove assignee"
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {assignments.length === 0 ? <p className="empty-state">No assignees.</p> : null}
        </div>
      </section>

      <section className="workflow-section" aria-labelledby="comments-title">
        <div className="subsection-heading">
          <div>
            <h3 id="comments-title">Comments</h3>
            <p>Editorial discussion for this entry.</p>
          </div>
        </div>
        {canWrite ? (
          <div className="comment-form">
            <textarea
              aria-label="New comment"
              maxLength={4000}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Add an editorial comment"
              value={comment}
            />
            <button
              className="button button-secondary"
              disabled={!comment.trim() || busy}
              onClick={() => {
                setBusy(true);
                void addComment(csrfToken, siteId, entry.id, comment.trim())
                  .then(() => {
                    setComment("");
                    load();
                  })
                  .catch((reason: unknown) => onError(editorialErrorMessage(reason)))
                  .finally(() => setBusy(false));
              }}
              type="button"
            >
              <MessageSquare aria-hidden="true" /> Comment
            </button>
          </div>
        ) : null}
        <div className="activity-list">
          {comments.map((item) => (
            <article key={item.id}>
              <header>
                <strong>{item.author.displayName}</strong>
                <time>{formatDate(item.createdAt)}</time>
              </header>
              <p>{item.body}</p>
            </article>
          ))}
          {comments.length === 0 ? <p className="empty-state">No comments.</p> : null}
        </div>
      </section>

      <section className="workflow-section wide-workflow-section" aria-labelledby="activity-title">
        <div className="subsection-heading">
          <div>
            <h3 id="activity-title">Activity</h3>
            <p>Reviews and workflow transitions.</p>
          </div>
        </div>
        <div className="activity-list">
          {reviews.map((item) => (
            <article key={item.id}>
              <header>
                <strong>
                  {item.reviewer.displayName} ·{" "}
                  {item.decision === "APPROVED" ? "Approved" : "Changes requested"}
                </strong>
                <time>{formatDate(item.createdAt)}</time>
              </header>
              {item.note ? <p>{item.note}</p> : null}
            </article>
          ))}
          {transitions.map((item) => (
            <article key={item.id}>
              <header>
                <strong>
                  {statusLabels[item.from]} → {statusLabels[item.to]}
                </strong>
                <time>{formatDate(item.createdAt)}</time>
              </header>
              <p>Revision {item.revision}</p>
            </article>
          ))}
          {reviews.length + transitions.length === 0 ? (
            <p className="empty-state">No workflow activity.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function RevisionsPanel({
  canWrite,
  csrfToken,
  entry,
  onError,
  onVersioned,
  revision,
  siteId,
}: {
  canWrite: boolean;
  csrfToken: string;
  entry: ContentEntryDetail;
  onError: (message: string) => void;
  onVersioned: (entry: ContentEntryDetail, version: number, notice: string) => void;
  revision: number;
  siteId: string;
}) {
  const [revisions, setRevisions] = useState<ContentRevision[] | null>(null);
  const [from, setFrom] = useState<number>();
  const [to, setTo] = useState<number>();
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listRevisions(siteId, entry.id)
      .then((items) => {
        setRevisions(items);
        setTo(items[0]?.revision);
        setFrom(items[1]?.revision ?? items[0]?.revision);
      })
      .catch((reason: unknown) => onError(editorialErrorMessage(reason)));
  }, [entry.id, revision, siteId]);
  async function compare() {
    if (!from || !to) return;
    setBusy(true);
    try {
      setComparison(await compareRevisions(siteId, entry.id, from, to));
    } catch (reason) {
      onError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function restore(target: number) {
    if (!window.confirm(`Restore revision ${target} as a new draft revision?`)) return;
    setBusy(true);
    try {
      const result = await restoreRevision(csrfToken, siteId, entry.id, target, revision);
      onVersioned(result.value, result.version, `Revision ${target} restored.`);
    } catch (reason) {
      onError(editorialErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="revisions-layout">
      <section className="revision-list" aria-labelledby="revision-history-title">
        <div className="subsection-heading">
          <div>
            <h3 id="revision-history-title">Revision history</h3>
            <p>Immutable snapshots of this entry.</p>
          </div>
        </div>
        {revisions === null ? (
          <LoadingLabel>Loading revisions</LoadingLabel>
        ) : (
          revisions.map((item) => (
            <article className="revision-row" key={item.revision}>
              <FileClock aria-hidden="true" />
              <span>
                <strong>Revision {item.revision}</strong>
                <small>
                  {statusLabels[item.status]} · {formatDate(item.createdAt)}
                </small>
              </span>
              {canWrite && item.revision !== revision ? (
                <button
                  className="button button-secondary compact-button"
                  disabled={busy}
                  onClick={() => void restore(item.revision)}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" /> Restore
                </button>
              ) : null}
            </article>
          ))
        )}
      </section>
      <section className="revision-compare" aria-labelledby="revision-compare-title">
        <div className="subsection-heading">
          <div>
            <h3 id="revision-compare-title">Compare revisions</h3>
            <p>Inspect field-level changes.</p>
          </div>
        </div>
        {revisions?.length ? (
          <div className="compare-controls">
            <label>
              From
              <select onChange={(event) => setFrom(Number(event.target.value))} value={from}>
                {revisions.map((item) => (
                  <option key={item.revision} value={item.revision}>
                    Revision {item.revision}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To
              <select onChange={(event) => setTo(Number(event.target.value))} value={to}>
                {revisions.map((item) => (
                  <option key={item.revision} value={item.revision}>
                    Revision {item.revision}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={busy || !from || !to}
              onClick={() => void compare()}
              type="button"
            >
              <Clock3 aria-hidden="true" /> Compare
            </button>
          </div>
        ) : null}
        {comparison ? (
          <div className="diff-list">
            {comparison.fieldChanges.map((change, index) => (
              <article key={`${change.localeCode}-${change.fieldKey}-${index}`}>
                <header>
                  <strong>{change.fieldKey}</strong>
                  <span>
                    {change.localeCode} · {change.change.toLowerCase()}
                  </span>
                </header>
                <div className="diff-values">
                  <pre>{JSON.stringify(change.before, null, 2) ?? "—"}</pre>
                  <pre>{JSON.stringify(change.after, null, 2) ?? "—"}</pre>
                </div>
              </article>
            ))}
            {comparison.fieldChanges.length === 0 ? (
              <p className="empty-state">These revisions have no field changes.</p>
            ) : null}
          </div>
        ) : (
          <div className="blank-state compact-blank">
            <FileClock aria-hidden="true" />
            <p>Choose two revisions to view their differences.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: ContentEntryStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase().replace("_", "-")}`}>
      {statusLabels[status]}
    </span>
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
