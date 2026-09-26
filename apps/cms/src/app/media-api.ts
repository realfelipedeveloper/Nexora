export type MediaAsset = {
  altText: string | null;
  checksumSha256: string;
  contentUrl: string;
  createdAt: string;
  displayName: string;
  extension: string;
  id: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  status: "READY";
  updatedAt: string;
  usageCount: number;
  version: number;
};

type MediaPage = { items: MediaAsset[]; nextCursor?: string };

export class MediaApiError extends Error {
  override readonly name = "MediaApiError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function message(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : "Media request failed.";
  } catch {
    return "Media request failed.";
  }
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/core${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) throw new MediaApiError(response.status, await message(response));
  return response;
}

export function mediaErrorMessage(error: unknown) {
  if (error instanceof MediaApiError) {
    if (error.status === 403) return "You do not have permission to manage this media.";
    if (error.status === 409) return "This asset is still used by content and cannot be deleted.";
    if (error.status === 412) return "This asset changed elsewhere. Reload before continuing.";
    if (error.status === 413) return "The file exceeds the 20 MiB upload limit.";
    if (error.status === 415) return "Use a JPEG, PNG, GIF, WebP, AVIF, or PDF file.";
    if (error.status === 503) return "Secure file scanning is unavailable. Try again shortly.";
    return error.message;
  }
  return "Media is unavailable right now. Try again.";
}

export async function listMedia(siteId: string, query = "") {
  const parameters = new URLSearchParams({ limit: "100" });
  if (query.trim()) parameters.set("q", query.trim());
  return (await request(`/sites/${siteId}/assets?${parameters}`)).json() as Promise<MediaPage>;
}

export async function uploadMedia(csrfToken: string, siteId: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  return (
    await request(`/sites/${siteId}/assets`, {
      body: form,
      headers: { "x-csrf-token": csrfToken },
      method: "POST",
    })
  ).json() as Promise<MediaAsset>;
}

export async function updateMedia(
  csrfToken: string,
  siteId: string,
  assetId: string,
  version: number,
  input: { altText: string; displayName: string },
) {
  return (
    await request(`/sites/${siteId}/assets/${assetId}`, {
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${version}"`,
        "x-csrf-token": csrfToken,
      },
      method: "PATCH",
    })
  ).json() as Promise<MediaAsset>;
}

export async function deleteMedia(
  csrfToken: string,
  siteId: string,
  assetId: string,
  version: number,
) {
  await request(`/sites/${siteId}/assets/${assetId}`, {
    headers: { "If-Match": `"${version}"`, "x-csrf-token": csrfToken },
    method: "DELETE",
  });
}
