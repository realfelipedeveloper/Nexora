"use client";

import { FileText, ImageIcon, RefreshCw, Save, Search, Trash2, Upload } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type MediaAsset,
  deleteMedia,
  listMedia,
  mediaErrorMessage,
  updateMedia,
  uploadMedia,
} from "./media-api";

type Props = { canWrite: boolean; csrfToken: string; siteId: string };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function Preview({ asset }: { asset: MediaAsset }) {
  return asset.mimeType.startsWith("image/") ? (
    <img alt={asset.altText || ""} loading="lazy" src={asset.contentUrl} />
  ) : (
    <span className="asset-file-preview" aria-hidden="true">
      <FileText />
      {asset.extension.toUpperCase()}
    </span>
  );
}

export function MediaLibraryView({ canWrite, csrfToken, siteId }: Props) {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = assets?.find((asset) => asset.id === selectedId) ?? null;

  function load(search = query) {
    setAssets(null);
    setError("");
    void listMedia(siteId, search)
      .then((page) => setAssets(page.items))
      .catch((reason: unknown) => setError(mediaErrorMessage(reason)));
  }

  useEffect(() => load(""), [siteId]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const asset = await uploadMedia(csrfToken, siteId, file);
      setAssets((items) => [asset, ...(items ?? [])]);
      setSelectedId(asset.id);
      setMessage("Asset uploaded and scanned.");
    } catch (reason) {
      setError(mediaErrorMessage(reason));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const asset = await updateMedia(csrfToken, siteId, selected.id, selected.version, {
        altText: String(data.get("altText") ?? ""),
        displayName: String(data.get("displayName") ?? ""),
      });
      setAssets((items) => items?.map((item) => (item.id === asset.id ? asset : item)) ?? []);
      setMessage("Asset details saved.");
    } catch (reason) {
      setError(mediaErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || !window.confirm("Delete this asset?")) return;
    setBusy(true);
    setError("");
    try {
      await deleteMedia(csrfToken, siteId, selected.id, selected.version);
      setAssets((items) => items?.filter((item) => item.id !== selected.id) ?? []);
      setSelectedId(null);
      setMessage("Asset deleted.");
    } catch (reason) {
      setError(mediaErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="editorial-page" aria-labelledby="media-library-title">
      <header className="page-toolbar">
        <div>
          <p className="eyebrow">Asset workspace</p>
          <h2 id="media-library-title">Media library</h2>
        </div>
        {canWrite ? (
          <>
            <input
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf"
              aria-label="Upload media file"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
              ref={fileInput}
              type="file"
            />
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              <Upload aria-hidden="true" />
              {busy ? "Scanning" : "Upload asset"}
            </button>
          </>
        ) : null}
      </header>
      {error ? (
        <p className="workspace-alert" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="success-notice" role="status">
          {message}
        </p>
      ) : null}
      <form
        className="entry-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
      >
        <label htmlFor="media-search">
          <Search aria-hidden="true" size={16} /> Search
        </label>
        <input id="media-search" onChange={(event) => setQuery(event.target.value)} value={query} />
        <button aria-label="Search media" className="icon-button" title="Search media">
          <RefreshCw aria-hidden="true" />
        </button>
      </form>
      <div className="master-detail-layout media-layout">
        <section className="media-grid media-library-grid" aria-label="Media assets">
          {assets === null ? <p className="settings-status">Loading media</p> : null}
          {assets?.map((asset) => (
            <button
              aria-current={selectedId === asset.id ? "true" : undefined}
              className="media-card"
              key={asset.id}
              onClick={() => setSelectedId(asset.id)}
              type="button"
            >
              <Preview asset={asset} />
              <span>{asset.displayName}</span>
              <small>
                {formatBytes(asset.sizeBytes)} · {asset.usageCount} use(s)
              </small>
            </button>
          ))}
          {assets?.length === 0 ? <p className="empty-state">No media matches this view.</p> : null}
        </section>
        <section className="detail-panel" aria-label="Asset details">
          {selected ? (
            <form
              className="editor-form asset-editor"
              key={`${selected.id}:${selected.version}`}
              onSubmit={(event) => void save(event)}
            >
              <div className="asset-detail-preview">
                <Preview asset={selected} />
              </div>
              <div>
                <h3>{selected.displayName}</h3>
                <p>
                  {selected.mimeType} · {formatBytes(selected.sizeBytes)}
                </p>
              </div>
              <label>
                Display name
                <input
                  defaultValue={selected.displayName}
                  disabled={!canWrite}
                  name="displayName"
                  required
                />
              </label>
              <label>
                Alternative text
                <input defaultValue={selected.altText ?? ""} disabled={!canWrite} name="altText" />
              </label>
              <dl className="asset-metadata">
                <div>
                  <dt>Checksum</dt>
                  <dd>{selected.checksumSha256.slice(0, 16)}…</dd>
                </div>
                <div>
                  <dt>Usage</dt>
                  <dd>{selected.usageCount} content relation(s)</dd>
                </div>
              </dl>
              {canWrite ? (
                <footer className="form-actions">
                  <button
                    className="button button-danger"
                    disabled={busy || selected.usageCount > 0}
                    onClick={() => void remove()}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </button>
                  <button className="button button-primary" disabled={busy}>
                    <Save aria-hidden="true" />
                    Save
                  </button>
                </footer>
              ) : null}
            </form>
          ) : (
            <div className="blank-state">
              <ImageIcon aria-hidden="true" />
              <h3>Select an asset</h3>
              <p>Review metadata, usage, or choose an upload.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
