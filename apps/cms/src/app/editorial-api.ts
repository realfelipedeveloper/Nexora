import type { ContentEntryStatus, InitialFieldType } from "@nexora/schemas";

export type FieldDefinition = {
  config: Record<string, unknown>;
  fieldType: InitialFieldType;
  id?: string;
  key: string;
  label: string;
  position: number;
  required: boolean;
};

export type ContentTypeSummary = {
  displayName: string;
  id: string;
  key: string;
  schemaVersion: number;
  updatedAt: string;
};

export type ContentTypeDetail = ContentTypeSummary & { fields: FieldDefinition[] };

export type EntryLocale = {
  data: Record<string, unknown>;
  locale: { code: string };
  localeId: string;
  revision: number;
  schemaVersion: number;
  updatedAt: string;
};

export type ContentEntrySummary = {
  contentLocales: Array<Pick<EntryLocale, "locale" | "localeId" | "revision" | "updatedAt">>;
  contentType: Pick<ContentTypeSummary, "displayName" | "id" | "key">;
  contentTypeId: string;
  id: string;
  publishedAt: string | null;
  revision: number;
  schemaVersion: number;
  status: ContentEntryStatus;
  updatedAt: string;
};

export type ContentEntryDetail = Omit<ContentEntrySummary, "contentLocales"> & {
  contentLocales: EntryLocale[];
};

export type EditorialContext = {
  locales: Array<{ code: string; id: string; isDefault: boolean }>;
  members: Array<{ displayName: string; id: string }>;
};

export type SiteAccess = {
  isSystemAdmin: boolean;
  permissionKeys: string[];
  roleKeys: string[];
  siteId: string;
};

export type Person = { displayName: string; id: string };
export type Assignment = { assignedBy: Person; assignee: Person; createdAt: string; id: string };
export type EditorialComment = { author: Person; body: string; createdAt: string; id: string };
export type EditorialReview = {
  contentRevision: number;
  createdAt: string;
  decision: "APPROVED" | "CHANGES_REQUESTED";
  id: string;
  note: string | null;
  reviewer: Person;
};
export type EditorialTransition = {
  actorId: string | null;
  createdAt: string;
  from: ContentEntryStatus;
  id: string;
  revision: number;
  to: ContentEntryStatus;
  transition: string;
};
export type ContentRevision = {
  actorId: string | null;
  createdAt: string;
  publishedAt: string | null;
  revision: number;
  schemaVersion: number;
  status: ContentEntryStatus;
};
export type FieldChange = {
  after?: unknown;
  before?: unknown;
  change: "ADDED" | "CHANGED" | "REMOVED";
  fieldKey: string;
  localeCode: string;
};
export type RevisionComparison = {
  fieldChanges: FieldChange[];
  from: ContentRevision;
  to: ContentRevision;
};

type Page<Value> = { items: Value[]; nextCursor?: string };
type Versioned<Value> = { value: Value; version: number };

export class EditorialApiError extends Error {
  override readonly name = "EditorialApiError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function errorMessage(response: Response) {
  try {
    const value: unknown = await response.json();
    return isRecord(value) && typeof value.message === "string"
      ? value.message
      : "The editorial request could not be completed.";
  } catch {
    return "The editorial request could not be completed.";
  }
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/core${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw new EditorialApiError(response.status, await errorMessage(response));
  }
  return response;
}

function versionFrom(response: Response) {
  const value = response.headers.get("etag")?.match(/^"([1-9][0-9]*)"$/u)?.[1];
  if (!value) {
    throw new TypeError("The editorial response did not include a valid version.");
  }
  return Number(value);
}

async function readJson<Value>(path: string): Promise<Value> {
  return (await request(path)).json() as Promise<Value>;
}

async function readVersioned<Value>(path: string): Promise<Versioned<Value>> {
  const response = await request(path);
  return { value: (await response.json()) as Value, version: versionFrom(response) };
}

async function mutate<Value>(
  path: string,
  csrfToken: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body?: unknown,
  version?: number,
) {
  const response = await request(path, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(version === undefined ? {} : { "If-Match": `"${version}"` }),
      "x-csrf-token": csrfToken,
    },
    method,
  });
  if (response.status === 204) {
    return undefined as Value;
  }
  return response.json() as Promise<Value>;
}

async function mutateVersioned<Value>(
  path: string,
  csrfToken: string,
  method: "PATCH" | "POST" | "PUT",
  body: unknown,
  version?: number,
): Promise<Versioned<Value>> {
  const response = await request(path, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(version === undefined ? {} : { "If-Match": `"${version}"` }),
      "x-csrf-token": csrfToken,
    },
    method,
  });
  return { value: (await response.json()) as Value, version: versionFrom(response) };
}

export function editorialErrorMessage(error: unknown) {
  if (error instanceof EditorialApiError) {
    if (error.status === 403) return "You do not have permission to perform this action.";
    if (error.status === 412) return "This content changed elsewhere. Reload before continuing.";
    if (error.status === 409) return error.message;
    if (error.status === 400) return "Review the highlighted content and try again.";
  }
  return "Editorial content is unavailable right now. Try again.";
}

export function getEditorialContext(siteId: string) {
  return readJson<EditorialContext>(`/sites/${siteId}/editorial-context`);
}

export function getSiteAccess(siteId: string) {
  return readJson<SiteAccess>(`/sites/${siteId}/access`);
}

export function listContentTypes(siteId: string) {
  return readJson<Page<ContentTypeSummary>>(`/sites/${siteId}/content-types?limit=100`);
}

export function getContentType(siteId: string, contentTypeId: string) {
  return readVersioned<ContentTypeDetail>(`/sites/${siteId}/content-types/${contentTypeId}`);
}

export function saveContentType(
  csrfToken: string,
  siteId: string,
  input: { displayName: string; fields: FieldDefinition[]; key?: string },
  current?: { id: string; version: number },
) {
  const fields = input.fields.map(({ config, fieldType, key, label, position, required }) => ({
    config,
    fieldType,
    key,
    label,
    position,
    required,
  }));
  return current
    ? mutateVersioned<ContentTypeDetail>(
        `/sites/${siteId}/content-types/${current.id}`,
        csrfToken,
        "PUT",
        { displayName: input.displayName, fields },
        current.version,
      )
    : mutateVersioned<ContentTypeDetail>(`/sites/${siteId}/content-types`, csrfToken, "POST", {
        displayName: input.displayName,
        fields,
        key: input.key,
      });
}

export function deleteContentType(
  csrfToken: string,
  siteId: string,
  contentTypeId: string,
  version: number,
) {
  return mutate<undefined>(
    `/sites/${siteId}/content-types/${contentTypeId}`,
    csrfToken,
    "DELETE",
    undefined,
    version,
  );
}

export function listContentEntries(siteId: string, contentTypeId?: string) {
  const query = new URLSearchParams({ limit: "100" });
  if (contentTypeId) query.set("contentTypeId", contentTypeId);
  return readJson<Page<ContentEntrySummary>>(`/sites/${siteId}/content-entries?${query}`);
}

export function getContentEntry(siteId: string, contentEntryId: string) {
  return readVersioned<ContentEntryDetail>(`/sites/${siteId}/content-entries/${contentEntryId}`);
}

export function saveContentEntry(
  csrfToken: string,
  siteId: string,
  input: {
    contentTypeId?: string;
    locales: Array<{ data: Record<string, unknown>; localeId: string }>;
  },
  current?: { id: string; revision: number },
) {
  return current
    ? mutateVersioned<ContentEntryDetail>(
        `/sites/${siteId}/content-entries/${current.id}`,
        csrfToken,
        "PUT",
        { locales: input.locales },
        current.revision,
      )
    : mutateVersioned<ContentEntryDetail>(
        `/sites/${siteId}/content-entries`,
        csrfToken,
        "POST",
        input,
      );
}

export function deleteContentEntry(
  csrfToken: string,
  siteId: string,
  contentEntryId: string,
  revision: number,
) {
  return mutate<undefined>(
    `/sites/${siteId}/content-entries/${contentEntryId}`,
    csrfToken,
    "DELETE",
    undefined,
    revision,
  );
}

export function changeEntryStatus(
  csrfToken: string,
  siteId: string,
  contentEntryId: string,
  revision: number,
  status: ContentEntryStatus,
) {
  return mutateVersioned<ContentEntryDetail>(
    `/sites/${siteId}/content-entries/${contentEntryId}/status`,
    csrfToken,
    "PATCH",
    { status },
    revision,
  );
}

function entryResource(siteId: string, contentEntryId: string, resource: string) {
  return `/sites/${siteId}/content-entries/${contentEntryId}/${resource}`;
}

export function listAssignments(siteId: string, contentEntryId: string) {
  return readJson<Page<Assignment>>(
    `${entryResource(siteId, contentEntryId, "assignments")}?limit=100`,
  );
}
export function addAssignment(
  csrfToken: string,
  siteId: string,
  contentEntryId: string,
  assigneeId: string,
) {
  return mutate<Assignment>(
    entryResource(siteId, contentEntryId, "assignments"),
    csrfToken,
    "POST",
    {
      assigneeId,
    },
  );
}
export function removeAssignment(
  csrfToken: string,
  siteId: string,
  contentEntryId: string,
  assignmentId: string,
) {
  return mutate<undefined>(
    `${entryResource(siteId, contentEntryId, "assignments")}/${assignmentId}`,
    csrfToken,
    "DELETE",
  );
}
export function listComments(siteId: string, contentEntryId: string) {
  return readJson<Page<EditorialComment>>(
    `${entryResource(siteId, contentEntryId, "comments")}?limit=100`,
  );
}
export function addComment(
  csrfToken: string,
  siteId: string,
  contentEntryId: string,
  body: string,
) {
  return mutate<EditorialComment>(
    entryResource(siteId, contentEntryId, "comments"),
    csrfToken,
    "POST",
    {
      body,
    },
  );
}
export function listReviews(siteId: string, contentEntryId: string) {
  return readJson<Page<EditorialReview>>(
    `${entryResource(siteId, contentEntryId, "reviews")}?limit=100`,
  );
}
export function addReview(
  csrfToken: string,
  siteId: string,
  contentEntryId: string,
  revision: number,
  decision: EditorialReview["decision"],
  note?: string,
) {
  return mutateVersioned<{
    entry: Pick<ContentEntryDetail, "id" | "publishedAt" | "revision" | "status" | "updatedAt">;
    review: EditorialReview;
  }>(
    entryResource(siteId, contentEntryId, "reviews"),
    csrfToken,
    "POST",
    { decision, ...(note ? { note } : {}) },
    revision,
  );
}
export function listTransitions(siteId: string, contentEntryId: string) {
  return readJson<Page<EditorialTransition>>(
    `${entryResource(siteId, contentEntryId, "transitions")}?limit=100`,
  );
}
export function listRevisions(siteId: string, contentEntryId: string) {
  return readJson<ContentRevision[]>(entryResource(siteId, contentEntryId, "revisions"));
}
export function compareRevisions(siteId: string, contentEntryId: string, from: number, to: number) {
  return readJson<RevisionComparison>(
    `${entryResource(siteId, contentEntryId, "revisions")}/compare?from=${from}&to=${to}`,
  );
}
export function restoreRevision(
  csrfToken: string,
  siteId: string,
  contentEntryId: string,
  revision: number,
  currentRevision: number,
) {
  return mutateVersioned<ContentEntryDetail>(
    `${entryResource(siteId, contentEntryId, "revisions")}/${revision}/restore`,
    csrfToken,
    "POST",
    undefined,
    currentRevision,
  );
}
