"use client";

import {
  Braces,
  Building2,
  CheckCircle2,
  CircleAlert,
  FileText,
  Files,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Save,
  Settings,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { initialFieldTypes } from "@nexora/schemas";
import type { CmsSession } from "./auth-api";
import { ContentTypesView } from "./content-types-view";
import {
  editorialErrorMessage,
  getEditorialContext,
  getSiteAccess,
  type EditorialContext,
  type SiteAccess,
} from "./editorial-api";
import { EntriesView } from "./entries-view";
import {
  CmsApiError,
  type CmsSite,
  type PlatformBranding,
  type SiteIdentity,
  type StoredSetting,
  listSites,
  readPlatformBranding,
  readSiteIdentity,
  savePlatformBranding,
  saveSiteIdentity,
} from "./settings-api";

type WorkspaceView = "overview" | "content-types" | "entries" | "settings";
type ResourceState<Value> =
  | { status: "loading" }
  | { setting: StoredSetting<Value> | null; status: "ready" }
  | { message: string; status: "error" };
type EditorialState =
  | { status: "idle" }
  | { status: "loading" }
  | { access: SiteAccess; context: EditorialContext; status: "ready" }
  | { message: string; status: "error" };

type CmsWorkspaceProps = {
  logoutError: boolean;
  onLogout: () => void;
  session: CmsSession;
  signingOut: boolean;
};

const defaultBranding: PlatformBranding = { productName: "Nexora" };

function settingsErrorMessage(error: unknown) {
  if (error instanceof CmsApiError && error.status === 403) {
    return "You do not have permission to view these settings.";
  }
  if (error instanceof CmsApiError && error.status === 412) {
    return "This setting changed elsewhere. Reload it before saving again.";
  }
  return "Settings are unavailable right now. Try again.";
}

function siteIdentityFromSetting(setting: StoredSetting<SiteIdentity> | null): SiteIdentity {
  return setting?.value ?? { displayName: "" };
}

export function CmsWorkspace({ logoutError, onLogout, session, signingOut }: CmsWorkspaceProps) {
  const [view, setView] = useState<WorkspaceView>("overview");
  const [sites, setSites] = useState<CmsSite[] | null>(null);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [branding, setBranding] = useState<ResourceState<PlatformBranding>>({ status: "loading" });
  const [siteIdentity, setSiteIdentity] = useState<ResourceState<SiteIdentity>>({
    status: "loading",
  });
  const [brandingForm, setBrandingForm] = useState(defaultBranding);
  const [identityForm, setIdentityForm] = useState<SiteIdentity>({ displayName: "" });
  const [saving, setSaving] = useState<"branding" | "identity" | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [editorial, setEditorial] = useState<EditorialState>({ status: "idle" });
  const [editorialReload, setEditorialReload] = useState(0);

  function loadSites() {
    setSitesError(null);
    setSites(null);
    void listSites()
      .then((availableSites) => {
        setSites(availableSites);
        setSelectedSiteId((currentSiteId) =>
          availableSites.some((site) => site.id === currentSiteId)
            ? currentSiteId
            : (availableSites[0]?.id ?? ""),
        );
      })
      .catch((error: unknown) => setSitesError(settingsErrorMessage(error)));
  }

  function loadBranding() {
    if (!session.user.isSystemAdmin) {
      return;
    }
    setBranding({ status: "loading" });
    void readPlatformBranding()
      .then((setting) => {
        setBranding({ setting, status: "ready" });
        setBrandingForm(setting?.value ?? defaultBranding);
      })
      .catch((error: unknown) =>
        setBranding({ message: settingsErrorMessage(error), status: "error" }),
      );
  }

  function loadSiteIdentity(siteId: string) {
    if (!siteId) {
      setSiteIdentity({ setting: null, status: "ready" });
      setIdentityForm({ displayName: "" });
      return;
    }
    setSiteIdentity({ status: "loading" });
    void readSiteIdentity(siteId)
      .then((setting) => {
        setSiteIdentity({ setting, status: "ready" });
        setIdentityForm(siteIdentityFromSetting(setting));
      })
      .catch((error: unknown) =>
        setSiteIdentity({ message: settingsErrorMessage(error), status: "error" }),
      );
  }

  useEffect(() => {
    loadSites();
    loadBranding();
  }, []);

  useEffect(() => {
    loadSiteIdentity(selectedSiteId);
  }, [selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId || (view !== "content-types" && view !== "entries")) {
      setEditorial({ status: "idle" });
      return;
    }
    setEditorial({ status: "loading" });
    void Promise.all([getSiteAccess(selectedSiteId), getEditorialContext(selectedSiteId)])
      .then(([access, context]) => setEditorial({ access, context, status: "ready" }))
      .catch((error: unknown) =>
        setEditorial({ message: editorialErrorMessage(error), status: "error" }),
      );
  }, [editorialReload, selectedSiteId, view]);

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (branding.status !== "ready") {
      return;
    }
    setSavedMessage("");
    setSaving("branding");
    try {
      const setting = await savePlatformBranding(
        session.csrfToken,
        { productName: brandingForm.productName.trim() },
        branding.setting,
      );
      setBranding({ setting, status: "ready" });
      setBrandingForm(setting.value);
      setSavedMessage("Platform branding saved.");
    } catch (error) {
      setBranding({ message: settingsErrorMessage(error), status: "error" });
    } finally {
      setSaving(null);
    }
  }

  async function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSiteId || siteIdentity.status !== "ready") {
      return;
    }
    setSavedMessage("");
    setSaving("identity");
    try {
      const description = identityForm.description?.trim();
      const setting = await saveSiteIdentity(
        session.csrfToken,
        selectedSiteId,
        {
          ...(description ? { description } : {}),
          displayName: identityForm.displayName.trim(),
        },
        siteIdentity.setting,
      );
      setSiteIdentity({ setting, status: "ready" });
      setIdentityForm(setting.value);
      setSavedMessage("Site identity saved.");
    } catch (error) {
      setSiteIdentity({ message: settingsErrorMessage(error), status: "error" });
    } finally {
      setSaving(null);
    }
  }

  const selectedSite = sites?.find((site) => site.id === selectedSiteId) ?? null;

  return (
    <main className="cms-shell">
      <aside className="sidebar">
        <header className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <div>
            <strong>Nexora</strong>
            <span>CMS</span>
          </div>
        </header>
        <nav aria-label="CMS navigation" className="cms-navigation">
          <button
            aria-current={view === "overview" ? "page" : undefined}
            className={view === "overview" ? "nav-item nav-current" : "nav-item"}
            onClick={() => setView("overview")}
            type="button"
          >
            <LayoutDashboard aria-hidden="true" size={18} />
            Overview
          </button>
          <button
            aria-current={view === "content-types" ? "page" : undefined}
            className={view === "content-types" ? "nav-item nav-current" : "nav-item"}
            onClick={() => setView("content-types")}
            type="button"
          >
            <Braces aria-hidden="true" size={18} />
            Content types
          </button>
          <button
            aria-current={view === "entries" ? "page" : undefined}
            className={view === "entries" ? "nav-item nav-current" : "nav-item"}
            onClick={() => setView("entries")}
            type="button"
          >
            <Files aria-hidden="true" size={18} />
            Entries
          </button>
          <button
            aria-current={view === "settings" ? "page" : undefined}
            className={view === "settings" ? "nav-item nav-current" : "nav-item"}
            onClick={() => setView("settings")}
            type="button"
          >
            <Settings aria-hidden="true" size={18} />
            Settings
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Content workspace</p>
            <h1>
              {view === "overview"
                ? "Overview"
                : view === "content-types"
                  ? "Content types"
                  : view === "entries"
                    ? "Entries"
                    : "Settings"}
            </h1>
          </div>
          <div className="header-actions">
            {sites && sites.length > 0 ? (
              <label className="header-site-selector" htmlFor="workspace-site-selector">
                <span>Site</span>
                <select
                  aria-label="Workspace site"
                  id="workspace-site-selector"
                  onChange={(event) => setSelectedSiteId(event.target.value)}
                  value={selectedSiteId}
                >
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="account-menu">
              <div className="account-copy">
                <strong>{session.user.displayName}</strong>
                <span>{session.user.email}</span>
              </div>
              <button
                aria-label="Sign out"
                className="icon-button account-logout"
                disabled={signingOut}
                onClick={onLogout}
                title="Sign out"
                type="button"
              >
                <LogOut aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {logoutError ? (
          <p className="workspace-alert" role="alert">
            <CircleAlert aria-hidden="true" size={17} />
            Sign-out failed. Your session remains active.
          </p>
        ) : null}

        {view === "overview" ? (
          <section className="content-section" aria-labelledby="content-model-title">
            <div className="section-heading">
              <div className="section-icon" aria-hidden="true">
                <FileText size={20} />
              </div>
              <div>
                <h2 id="content-model-title">Content model foundation</h2>
                <p>Available field types</p>
              </div>
            </div>
            <section className="field-grid" aria-label="Initial field types">
              {initialFieldTypes.map((field) => (
                <article key={field} className="field-tile">
                  {field}
                </article>
              ))}
            </section>
          </section>
        ) : null}

        {view === "content-types" || view === "entries" ? (
          !selectedSiteId ? (
            <p className="empty-state editorial-empty">
              Select an available site to manage content.
            </p>
          ) : editorial.status === "loading" || editorial.status === "idle" ? (
            <p className="settings-status editorial-loading" aria-live="polite">
              <LoaderCircle aria-hidden="true" className="spin" size={18} /> Loading editorial
              workspace
            </p>
          ) : editorial.status === "error" ? (
            <SettingsFailure onRetry={() => setEditorialReload((current) => current + 1)}>
              {editorial.message}
            </SettingsFailure>
          ) : view === "content-types" ? (
            <ContentTypesView
              canWrite={editorial.access.permissionKeys.includes("content.write")}
              csrfToken={session.csrfToken}
              key={selectedSiteId}
              siteId={selectedSiteId}
            />
          ) : (
            <EntriesView
              canPublish={editorial.access.permissionKeys.includes("content.publish")}
              canWrite={editorial.access.permissionKeys.includes("content.write")}
              context={editorial.context}
              csrfToken={session.csrfToken}
              key={selectedSiteId}
              siteId={selectedSiteId}
            />
          )
        ) : null}

        {view === "settings" ? (
          <section className="settings-layout" aria-label="CMS settings">
            {session.user.isSystemAdmin ? (
              <section className="settings-section" aria-labelledby="platform-branding-title">
                <div className="section-heading">
                  <div className="section-icon" aria-hidden="true">
                    <Settings size={20} />
                  </div>
                  <div>
                    <h2 id="platform-branding-title">Platform branding</h2>
                    <p>Visible to system administrators.</p>
                  </div>
                </div>
                {branding.status === "loading" ? (
                  <p className="settings-status" aria-live="polite">
                    <LoaderCircle aria-hidden="true" className="spin" size={18} /> Loading platform
                    branding
                  </p>
                ) : null}
                {branding.status === "error" ? (
                  <SettingsFailure onRetry={loadBranding}>{branding.message}</SettingsFailure>
                ) : null}
                {branding.status === "ready" ? (
                  <form className="settings-form" onSubmit={(event) => void saveBranding(event)}>
                    <label htmlFor="product-name">Product name</label>
                    <input
                      id="product-name"
                      maxLength={80}
                      onChange={(event) =>
                        setBrandingForm((current) => ({
                          ...current,
                          productName: event.target.value,
                        }))
                      }
                      required
                      value={brandingForm.productName}
                    />
                    <button
                      className="button button-primary settings-save"
                      disabled={saving !== null}
                    >
                      {saving === "branding" ? (
                        <LoaderCircle aria-hidden="true" className="spin" />
                      ) : (
                        <Save aria-hidden="true" />
                      )}
                      {saving === "branding" ? "Saving" : "Save branding"}
                    </button>
                  </form>
                ) : null}
              </section>
            ) : null}

            <section className="settings-section" aria-labelledby="site-settings-title">
              <div className="section-heading">
                <div className="section-icon" aria-hidden="true">
                  <Building2 size={20} />
                </div>
                <div>
                  <h2 id="site-settings-title">Site settings</h2>
                  <p>Choose a site you can access.</p>
                </div>
              </div>
              {sitesError ? (
                <SettingsFailure onRetry={loadSites}>{sitesError}</SettingsFailure>
              ) : null}
              {sites === null && !sitesError ? (
                <p className="settings-status" aria-live="polite">
                  <LoaderCircle aria-hidden="true" className="spin" size={18} /> Loading sites
                </p>
              ) : null}
              {sites?.length === 0 ? (
                <p className="empty-state">No sites are available for this account.</p>
              ) : null}
              {sites && sites.length > 0 ? (
                <>
                  <label htmlFor="site-selector">Current site</label>
                  <select
                    id="site-selector"
                    onChange={(event) => setSelectedSiteId(event.target.value)}
                    value={selectedSiteId}
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} {site.status === "ARCHIVED" ? "(Archived)" : ""}
                      </option>
                    ))}
                  </select>
                  {selectedSite ? <p className="site-key">Site key: {selectedSite.key}</p> : null}
                  {siteIdentity.status === "loading" ? (
                    <p className="settings-status" aria-live="polite">
                      <LoaderCircle aria-hidden="true" className="spin" size={18} /> Loading site
                      identity
                    </p>
                  ) : null}
                  {siteIdentity.status === "error" ? (
                    <SettingsFailure onRetry={() => loadSiteIdentity(selectedSiteId)}>
                      {siteIdentity.message}
                    </SettingsFailure>
                  ) : null}
                  {siteIdentity.status === "ready" ? (
                    <form className="settings-form" onSubmit={(event) => void saveIdentity(event)}>
                      <label htmlFor="site-display-name">Display name</label>
                      <input
                        id="site-display-name"
                        maxLength={120}
                        onChange={(event) =>
                          setIdentityForm((current) => ({
                            ...current,
                            displayName: event.target.value,
                          }))
                        }
                        required
                        value={identityForm.displayName}
                      />
                      <label htmlFor="site-description">
                        Description <span className="optional-label">Optional</span>
                      </label>
                      <textarea
                        id="site-description"
                        maxLength={500}
                        onChange={(event) =>
                          setIdentityForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        value={identityForm.description ?? ""}
                      />
                      <button
                        className="button button-primary settings-save"
                        disabled={saving !== null}
                      >
                        {saving === "identity" ? (
                          <LoaderCircle aria-hidden="true" className="spin" />
                        ) : (
                          <Save aria-hidden="true" />
                        )}
                        {saving === "identity" ? "Saving" : "Save site settings"}
                      </button>
                    </form>
                  ) : null}
                </>
              ) : null}
            </section>
            <p className="save-notice" aria-live="polite">
              {savedMessage ? (
                <>
                  <CheckCircle2 aria-hidden="true" size={17} /> {savedMessage}
                </>
              ) : null}
            </p>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function SettingsFailure({ children, onRetry }: { children: string; onRetry: () => void }) {
  return (
    <div className="settings-failure" role="alert">
      <CircleAlert aria-hidden="true" size={18} />
      <p>{children}</p>
      <button className="button button-secondary" onClick={onRetry} type="button">
        <RefreshCw aria-hidden="true" /> Reload
      </button>
    </div>
  );
}
