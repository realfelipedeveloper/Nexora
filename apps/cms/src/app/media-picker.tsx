"use client";

import { Check, FileText, ImageIcon, Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type MediaAsset, listMedia, mediaErrorMessage, uploadMedia } from "./media-api";

type Props = {
  canUpload: boolean;
  csrfToken: string;
  disabled: boolean;
  multiple: boolean;
  onChange: (value: string | string[] | undefined) => void;
  siteId: string;
  value: unknown;
};

function AssetPreview({ asset }: { asset: MediaAsset }) {
  return asset.mimeType.startsWith("image/") ? (
    <img alt={asset.altText || ""} loading="lazy" src={asset.contentUrl} />
  ) : (
    <span className="asset-file-preview" aria-hidden="true">
      <FileText />
      {asset.extension.toUpperCase()}
    </span>
  );
}

export function MediaFieldPicker({
  canUpload,
  csrfToken,
  disabled,
  multiple,
  onChange,
  siteId,
  value,
}: Props) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const current = multiple
    ? Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
    : typeof value === "string"
      ? [value]
      : [];

  function load() {
    setError("");
    void listMedia(siteId)
      .then((page) => setAssets(page.items))
      .catch((reason: unknown) => setError(mediaErrorMessage(reason)));
  }

  useEffect(() => {
    if (open) {
      setSelected(current);
      load();
    }
  }, [open, siteId]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const asset = await uploadMedia(csrfToken, siteId, file);
      setAssets((items) => [asset, ...items]);
      setSelected((items) => (multiple ? [...new Set([...items, asset.id])] : [asset.id]));
    } catch (reason) {
      setError(mediaErrorMessage(reason));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const selectedAssets = assets.filter((asset) => current.includes(asset.id));
  return (
    <div className="media-field-picker wide-field">
      <div className="selected-media-strip">
        {selectedAssets.map((asset) => (
          <div className="selected-media-item" key={asset.id}>
            <AssetPreview asset={asset} />
            <span>{asset.displayName}</span>
          </div>
        ))}
        {current.length > 0 && selectedAssets.length === 0 ? (
          <span className="media-reference-count">{current.length} selected asset(s)</span>
        ) : null}
      </div>
      <div className="media-field-actions">
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() => setOpen(true)}
          type="button"
        >
          <ImageIcon aria-hidden="true" /> {current.length ? "Change media" : "Choose media"}
        </button>
        {current.length ? (
          <button
            aria-label="Clear media"
            className="icon-button"
            disabled={disabled}
            onClick={() => onChange(multiple ? [] : undefined)}
            title="Clear media"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="media-modal-backdrop" role="presentation">
          <section
            aria-labelledby="media-picker-title"
            aria-modal="true"
            className="media-modal"
            role="dialog"
          >
            <header className="media-modal-header">
              <div>
                <h3 id="media-picker-title">Choose media</h3>
                <p>{multiple ? "Select one or more assets." : "Select one asset."}</p>
              </div>
              <button
                aria-label="Close media picker"
                className="icon-button"
                onClick={() => setOpen(false)}
                title="Close"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </header>
            {error ? (
              <p className="workspace-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="media-grid media-picker-grid">
              {assets.map((asset) => {
                const active = selected.includes(asset.id);
                return (
                  <button
                    aria-pressed={active}
                    className={active ? "media-card media-card-selected" : "media-card"}
                    key={asset.id}
                    onClick={() =>
                      setSelected((items) =>
                        multiple
                          ? active
                            ? items.filter((id) => id !== asset.id)
                            : [...items, asset.id]
                          : [asset.id],
                      )
                    }
                    type="button"
                  >
                    <AssetPreview asset={asset} />
                    <span>{asset.displayName}</span>
                    {active ? <Check aria-hidden="true" className="media-card-check" /> : null}
                  </button>
                );
              })}
              {assets.length === 0 ? <p className="empty-state">No media uploaded yet.</p> : null}
            </div>
            <footer className="media-modal-actions">
              {canUpload ? (
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
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    <Upload aria-hidden="true" /> {busy ? "Scanning" : "Upload"}
                  </button>
                </>
              ) : (
                <span />
              )}
              <button
                className="button button-primary"
                disabled={multiple ? false : selected.length !== 1}
                onClick={() => {
                  onChange(multiple ? selected : selected[0]);
                  setOpen(false);
                }}
                type="button"
              >
                <Plus aria-hidden="true" /> Use selected
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
