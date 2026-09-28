"use client";

import type { FeatureFlagKey } from "@nexora/schemas";
import {
  Check,
  CircleAlert,
  Languages,
  LoaderCircle,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  createLocale,
  deleteLocale,
  listLocales,
  LocalizationApiError,
  type SiteLocale,
  updateLocale,
} from "./localization-api";
import {
  CmsApiError,
  cmsFeatureFlagKeys,
  type FeatureFlags,
  readPlatformFeatures,
  readResolvedSiteFeatures,
  readSiteFeatures,
  savePlatformFeatures,
  saveSiteFeatures,
  type StoredSetting,
} from "./settings-api";

type Props = { csrfToken: string; isSystemAdmin: boolean; siteId: string };
type LoadState = "error" | "loading" | "ready";

const labels: Record<FeatureFlagKey, string> = {
  "engagement.comments": "Public comments",
  "engagement.newsletter": "Newsletter",
  "public.search": "Public search",
};

const featureFlagDefaults = Object.fromEntries(
  cmsFeatureFlagKeys.map((key) => [key, false]),
) as Record<FeatureFlagKey, boolean>;

function message(error: unknown) {
  if (
    (error instanceof CmsApiError || error instanceof LocalizationApiError) &&
    error.status === 412
  ) {
    return "This configuration changed elsewhere. Reload before trying again.";
  }
  if (
    (error instanceof CmsApiError || error instanceof LocalizationApiError) &&
    error.status === 403
  ) {
    return "You do not have permission to manage this configuration.";
  }
  if (error instanceof LocalizationApiError && error.status === 409) {
    return "The locale is in use or would create an invalid fallback.";
  }
  return "Configuration is unavailable right now. Try again.";
}

export function ConfigurationLocalizationSettings({ csrfToken, isSystemAdmin, siteId }: Props) {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [platform, setPlatform] = useState<StoredSetting<FeatureFlags> | null>(null);
  const [platformForm, setPlatformForm] = useState<FeatureFlags>({});
  const [site, setSite] = useState<StoredSetting<FeatureFlags> | null>(null);
  const [siteForm, setSiteForm] = useState<FeatureFlags>({});
  const [effective, setEffective] = useState<Record<FeatureFlagKey, boolean>>(featureFlagDefaults);
  const [locales, setLocales] = useState<SiteLocale[]>([]);
  const [newCode, setNewCode] = useState("");
  const [newFallback, setNewFallback] = useState("");
  const [newDefault, setNewDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() {
    if (!siteId) return;
    setState("loading");
    setError("");
    const platformRequest = isSystemAdmin ? readPlatformFeatures() : Promise.resolve(null);
    void Promise.all([
      platformRequest,
      readSiteFeatures(siteId),
      readResolvedSiteFeatures(siteId),
      listLocales(siteId),
    ])
      .then(([platformSetting, siteSetting, resolved, availableLocales]) => {
        setPlatform(platformSetting);
        setPlatformForm(platformSetting?.value ?? {});
        setSite(siteSetting);
        setSiteForm(siteSetting?.value ?? {});
        setEffective(resolved.flags);
        setLocales(availableLocales);
        setState("ready");
      })
      .catch((reason: unknown) => {
        setError(message(reason));
        setState("error");
      });
  }

  useEffect(load, [isSystemAdmin, siteId]);

  async function persistPlatform(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      setPlatform(await savePlatformFeatures(csrfToken, platformForm, platform));
      setNotice("Platform feature defaults saved.");
      load();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  }

  async function persistSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      setSite(await saveSiteFeatures(csrfToken, siteId, siteForm, site));
      setNotice("Site feature overrides saved.");
      load();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  }

  async function addLocale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createLocale(csrfToken, siteId, {
        code: newCode,
        ...(newDefault ? { isDefault: true } : {}),
        ...(!newDefault && newFallback ? { fallbackLocaleId: newFallback } : {}),
      });
      setNewCode("");
      setNewFallback("");
      setNewDefault(false);
      setNotice("Locale added.");
      load();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  }

  async function changeLocale(
    locale: SiteLocale,
    input: { fallbackLocaleId?: string | null; isDefault?: boolean },
  ) {
    setSaving(true);
    setError("");
    try {
      await updateLocale(csrfToken, siteId, locale, input);
      setNotice("Locale configuration saved.");
      load();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  }

  async function removeLocale(locale: SiteLocale) {
    setSaving(true);
    setError("");
    try {
      await deleteLocale(csrfToken, siteId, locale);
      setNotice("Locale removed.");
      load();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") {
    return (
      <p className="settings-status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="spin" size={18} /> Loading configuration
      </p>
    );
  }
  if (state === "error") {
    return (
      <div className="settings-failure" role="alert">
        <CircleAlert aria-hidden="true" size={18} />
        <p>{error}</p>
        <button className="button button-secondary" onClick={load} type="button">
          Reload
        </button>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p className="workspace-alert" role="alert">
          <CircleAlert aria-hidden="true" size={17} />
          {error}
        </p>
      ) : null}
      <section className="settings-section" aria-labelledby="feature-flags-title">
        <div className="section-heading">
          <div className="section-icon" aria-hidden="true">
            <SlidersHorizontal size={20} />
          </div>
          <div>
            <h2 id="feature-flags-title">Feature flags</h2>
            <p>Safe defaults with site-scoped overrides.</p>
          </div>
        </div>
        {isSystemAdmin ? (
          <form className="settings-form" onSubmit={(event) => void persistPlatform(event)}>
            <h3>Platform defaults</h3>
            {cmsFeatureFlagKeys.map((key) => (
              <label className="checkbox-label" key={key}>
                <input
                  checked={platformForm[key] ?? false}
                  onChange={(event) =>
                    setPlatformForm((current) => ({ ...current, [key]: event.target.checked }))
                  }
                  type="checkbox"
                />
                {labels[key]}
              </label>
            ))}
            <button className="button button-secondary settings-save" disabled={saving}>
              <Save aria-hidden="true" /> Save platform defaults
            </button>
          </form>
        ) : null}
        <form
          className="settings-form feature-overrides"
          onSubmit={(event) => void persistSite(event)}
        >
          <h3>Site overrides</h3>
          {cmsFeatureFlagKeys.map((key) => (
            <label className="feature-override" key={key}>
              <span>
                {labels[key]} <small>{effective[key] ? "Enabled" : "Disabled"}</small>
              </span>
              <select
                aria-label={`${labels[key]} override`}
                onChange={(event) => {
                  const value = event.target.value;
                  setSiteForm((current) => {
                    if (value === "inherit") {
                      return Object.fromEntries(
                        Object.entries(current).filter(([candidate]) => candidate !== key),
                      ) as FeatureFlags;
                    }
                    return { ...current, [key]: value === "enabled" };
                  });
                }}
                value={
                  siteForm[key] === undefined ? "inherit" : siteForm[key] ? "enabled" : "disabled"
                }
              >
                <option value="inherit">Inherit</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          ))}
          <button className="button button-primary settings-save" disabled={saving}>
            <Save aria-hidden="true" /> Save site overrides
          </button>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="locales-title">
        <div className="section-heading">
          <div className="section-icon" aria-hidden="true">
            <Languages size={20} />
          </div>
          <div>
            <h2 id="locales-title">Locales and fallbacks</h2>
            <p>Deterministic language resolution for this site.</p>
          </div>
        </div>
        <form className="locale-create" onSubmit={(event) => void addLocale(event)}>
          <label htmlFor="new-locale-code">Locale code</label>
          <input
            id="new-locale-code"
            maxLength={35}
            onChange={(event) => setNewCode(event.target.value)}
            placeholder="pt-BR"
            required
            value={newCode}
          />
          <label htmlFor="new-locale-fallback">Fallback</label>
          <select
            disabled={newDefault}
            id="new-locale-fallback"
            onChange={(event) => setNewFallback(event.target.value)}
            value={newFallback}
          >
            <option value="">None</option>
            {locales.map((locale) => (
              <option key={locale.id} value={locale.id}>
                {locale.code}
              </option>
            ))}
          </select>
          <label className="checkbox-label">
            <input
              checked={newDefault}
              onChange={(event) => {
                setNewDefault(event.target.checked);
                if (event.target.checked) setNewFallback("");
              }}
              type="checkbox"
            />
            Default locale
          </label>
          <button className="button button-primary" disabled={saving}>
            <Plus aria-hidden="true" /> Add locale
          </button>
        </form>
        <div className="locale-list" role="list">
          {locales.map((locale) => (
            <div className="locale-row" key={locale.id} role="listitem">
              <div>
                <strong>{locale.code}</strong>
                {locale.isDefault ? (
                  <span className="status-chip">
                    <Check aria-hidden="true" size={14} /> Default
                  </span>
                ) : null}
              </div>
              <label>
                Fallback
                <select
                  aria-label={`${locale.code} fallback`}
                  disabled={saving || locale.isDefault}
                  onChange={(event) =>
                    void changeLocale(locale, { fallbackLocaleId: event.target.value || null })
                  }
                  value={locale.fallbackLocaleId ?? ""}
                >
                  <option value="">None</option>
                  {locales
                    .filter((candidate) => candidate.id !== locale.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.code}
                      </option>
                    ))}
                </select>
              </label>
              {!locale.isDefault ? (
                <button
                  className="icon-button"
                  disabled={saving}
                  onClick={() => void changeLocale(locale, { isDefault: true })}
                  title="Set as default"
                  type="button"
                >
                  <Check aria-hidden="true" />
                </button>
              ) : null}
              {!locale.isDefault ? (
                <button
                  aria-label={`Delete ${locale.code}`}
                  className="icon-button danger-icon"
                  disabled={saving}
                  onClick={() => void removeLocale(locale)}
                  title="Delete locale"
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <p className="save-notice" aria-live="polite">
        {notice ? (
          <>
            <Check aria-hidden="true" size={17} /> {notice}
          </>
        ) : null}
      </p>
    </>
  );
}
