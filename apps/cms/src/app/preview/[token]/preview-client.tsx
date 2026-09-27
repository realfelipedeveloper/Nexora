"use client";

import type { ContentPreview } from "@nexora/contracts";
import { renderRichTextHtml } from "@nexora/rich-text";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const tokenPattern = /^[A-Za-z0-9_-]{32}$/u;

function isRichText(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "doc" &&
    (value as Record<string, unknown>).schemaVersion === 1,
  );
}

function PreviewField({
  fieldKey,
  token,
  value,
}: {
  fieldKey: string;
  token: string;
  value: unknown;
}) {
  if (isRichText(value)) {
    const html = renderRichTextHtml(
      value,
      (assetId) => `/api/core/previews/${encodeURIComponent(token)}/assets/${assetId}`,
    );
    return (
      <section className="preview-field">
        <h2>{fieldKey}</h2>
        <div className="preview-rich-text" dangerouslySetInnerHTML={{ __html: html }} />
      </section>
    );
  }
  if (typeof value === "string" || typeof value === "number") {
    return (
      <section className="preview-field">
        <h2>{fieldKey}</h2>
        <p>{value}</p>
      </section>
    );
  }
  if (typeof value === "boolean") {
    return (
      <section className="preview-field">
        <h2>{fieldKey}</h2>
        <p>{value ? "Yes" : "No"}</p>
      </section>
    );
  }
  return (
    <section className="preview-field">
      <h2>{fieldKey}</h2>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function UnavailablePreview({ unavailable }: { unavailable: boolean }) {
  return (
    <main className="preview-unavailable">
      <div aria-hidden="true" className="preview-mark">
        N
      </div>
      <h1>{unavailable ? "Preview unavailable" : "Preview expired"}</h1>
      <p>
        {unavailable
          ? "The preview service could not be reached."
          : "Return to the CMS and generate a new secure preview."}
      </p>
    </main>
  );
}

export function ContentPreviewClient() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [preview, setPreview] = useState<ContentPreview | null>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(undefined);
    setUnavailable(false);
    if (!tokenPattern.test(token)) {
      setPreview(null);
      return () => controller.abort();
    }
    void fetch(`/api/core/previews/${encodeURIComponent(token)}`, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Preview service is unavailable.");
        return response.json() as Promise<ContentPreview>;
      })
      .then((value) => setPreview(value))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUnavailable(true);
        setPreview(null);
      });
    return () => controller.abort();
  }, [token]);

  if (preview === undefined) {
    return (
      <main className="preview-unavailable">
        <div aria-hidden="true" className="preview-mark">
          N
        </div>
        <h1>Loading preview</h1>
      </main>
    );
  }
  if (!preview) return <UnavailablePreview unavailable={unavailable} />;

  return (
    <main className="content-preview">
      <header className="preview-banner">
        <div>
          <strong>Secure preview</strong>
          <span>
            {preview.status.replace("_", " ").toLowerCase()} · revision {preview.revision} ·{" "}
            {preview.locale}
          </span>
        </div>
        <span>Expires {new Date(preview.expiresAt).toLocaleTimeString("en")}</span>
      </header>
      <article className="preview-document">
        <header>
          <p className="preview-site-name">{preview.site.name}</p>
          <h1>{preview.contentType.displayName}</h1>
          {preview.scheduledPublication ? (
            <p className="preview-schedule">
              {preview.scheduledPublication.action === "PUBLISH" ? "Publication" : "Unpublishing"}{" "}
              scheduled for{" "}
              {new Date(preview.scheduledPublication.scheduledFor).toLocaleString("en")}
            </p>
          ) : null}
        </header>
        {Object.entries(preview.data).map(([fieldKey, value]) => (
          <PreviewField fieldKey={fieldKey} key={fieldKey} token={token} value={value} />
        ))}
      </article>
    </main>
  );
}
