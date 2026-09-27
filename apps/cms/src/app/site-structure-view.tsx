"use client";

import {
  CircleAlert,
  FileInput,
  FolderTree,
  Link2,
  ListTree,
  LoaderCircle,
  Map,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  listContentEntries,
  type ContentEntrySummary,
  type EditorialContext,
} from "./editorial-api";
import {
  createMenu,
  createMenuItem,
  createRoute,
  createSection,
  deleteMenu,
  deleteMenuItem,
  deletePlacement,
  deleteRoute,
  deleteSection,
  listMenuItems,
  listMenus,
  listPlacements,
  listRoutes,
  listSections,
  savePlacement,
  siteStructureErrorMessage,
  updateMenu,
  updateMenuItem,
  updateRoute,
  updateSection,
  type ContentPlacement,
  type MenuItem,
  type MenuItemInput,
  type SiteMenu,
  type SiteRoute,
  type SiteSection,
} from "./site-structure-api";

type Props = {
  canWrite: boolean;
  context: EditorialContext;
  csrfToken: string;
  siteId: string;
};
type StructureTab = "menus" | "routes" | "sections";

function entryLabel(entries: ContentEntrySummary[], id: string | null) {
  if (!id) return "No entry";
  const entry = entries.find((candidate) => candidate.id === id);
  return entry ? `${entry.contentType.displayName} · ${entry.id.slice(0, 8)}` : id.slice(0, 8);
}

function InlineAlert({ children }: { children: string }) {
  return (
    <p className="inline-alert" role="alert">
      <CircleAlert aria-hidden="true" size={17} /> {children}
    </p>
  );
}

function Loading({ children }: { children: string }) {
  return (
    <p className="loading-label" aria-live="polite">
      <LoaderCircle aria-hidden="true" className="spin" size={17} /> {children}
    </p>
  );
}

export function SiteStructureView({ canWrite, context, csrfToken, siteId }: Props) {
  const [tab, setTab] = useState<StructureTab>("sections");

  return (
    <section className="editorial-page" aria-labelledby="site-structure-title">
      <header className="page-toolbar">
        <div>
          <p className="eyebrow">Delivery workspace</p>
          <h2 id="site-structure-title">Site structure</h2>
        </div>
      </header>
      <div className="structure-tabs" role="tablist" aria-label="Site structure areas">
        <button
          aria-selected={tab === "sections"}
          className={tab === "sections" ? "structure-tab structure-tab-active" : "structure-tab"}
          onClick={() => setTab("sections")}
          role="tab"
          type="button"
        >
          <FolderTree aria-hidden="true" /> Sections
        </button>
        <button
          aria-selected={tab === "routes"}
          className={tab === "routes" ? "structure-tab structure-tab-active" : "structure-tab"}
          onClick={() => setTab("routes")}
          role="tab"
          type="button"
        >
          <Map aria-hidden="true" /> Routes
        </button>
        <button
          aria-selected={tab === "menus"}
          className={tab === "menus" ? "structure-tab structure-tab-active" : "structure-tab"}
          onClick={() => setTab("menus")}
          role="tab"
          type="button"
        >
          <ListTree aria-hidden="true" /> Menus
        </button>
      </div>
      {!canWrite ? <p className="read-only-notice">Site structure is read-only.</p> : null}
      {tab === "sections" ? (
        <SectionsPanel canWrite={canWrite} csrfToken={csrfToken} siteId={siteId} />
      ) : null}
      {tab === "routes" ? (
        <RoutesPanel canWrite={canWrite} context={context} csrfToken={csrfToken} siteId={siteId} />
      ) : null}
      {tab === "menus" ? (
        <MenusPanel canWrite={canWrite} context={context} csrfToken={csrfToken} siteId={siteId} />
      ) : null}
    </section>
  );
}

function SectionsPanel({ canWrite, csrfToken, siteId }: Omit<Props, "context">) {
  const [sections, setSections] = useState<SiteSection[] | null>(null);
  const [entries, setEntries] = useState<ContentEntrySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [placements, setPlacements] = useState<ContentPlacement[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    setSections(null);
    setError("");
    void Promise.all([listSections(siteId), listContentEntries(siteId)])
      .then(([sectionPage, entryPage]) => {
        setSections(sectionPage.items);
        setEntries(entryPage.items);
        setSelectedId((current) =>
          current && current !== "new" && !sectionPage.items.some((item) => item.id === current)
            ? null
            : current,
        );
      })
      .catch((reason: unknown) => setError(siteStructureErrorMessage(reason)));
  }

  function loadPlacements(sectionId: string) {
    setPlacements(null);
    void listPlacements(siteId, sectionId)
      .then((page) => setPlacements(page.items))
      .catch((reason: unknown) => setError(siteStructureErrorMessage(reason)));
  }

  useEffect(load, [siteId]);
  useEffect(() => {
    if (selectedId && selectedId !== "new") loadPlacements(selectedId);
    else setPlacements(null);
  }, [selectedId, siteId]);

  const selected = sections?.find((section) => section.id === selectedId);

  return (
    <div className="master-detail-layout structure-layout">
      <section className="resource-list" aria-label="Sections">
        <div className="resource-list-toolbar">
          <strong>Sections</strong>
          <div>
            <button
              aria-label="Refresh sections"
              className="icon-button"
              onClick={load}
              title="Refresh sections"
              type="button"
            >
              <RefreshCw aria-hidden="true" />
            </button>
            {canWrite ? (
              <button
                aria-label="New section"
                className="icon-button"
                onClick={() => setSelectedId("new")}
                title="New section"
                type="button"
              >
                <Plus aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        {sections === null ? <Loading>Loading sections</Loading> : null}
        {sections?.length === 0 ? (
          <p className="empty-state compact-empty">No sections yet.</p>
        ) : null}
        {sections?.map((section) => (
          <button
            aria-current={selectedId === section.id ? "true" : undefined}
            className="resource-row"
            key={section.id}
            onClick={() => setSelectedId(section.id)}
            type="button"
          >
            <FolderTree aria-hidden="true" size={18} />
            <span>
              <strong>{section.name}</strong>
              <small>{section.key}</small>
            </span>
          </button>
        ))}
      </section>
      <section className="detail-panel" aria-label="Section editor">
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {selectedId ? (
          <SectionEditor
            canWrite={canWrite}
            csrfToken={csrfToken}
            entries={entries}
            onPlacementsMutated={() => {
              if (selected) loadPlacements(selected.id);
            }}
            onRemoved={() => {
              setSelectedId(null);
              load();
            }}
            onSaved={(section) => {
              setSelectedId(section.id);
              load();
            }}
            placements={placements}
            saving={saving}
            section={selected}
            sections={sections ?? []}
            setError={setError}
            setSaving={setSaving}
            siteId={siteId}
          />
        ) : (
          <div className="blank-state">
            <FolderTree aria-hidden="true" />
            <h3>Select a section</h3>
            <p>Organize entries into delivery sections.</p>
          </div>
        )}
      </section>
    </div>
  );
}

type SectionEditorProps = {
  canWrite: boolean;
  csrfToken: string;
  entries: ContentEntrySummary[];
  onPlacementsMutated: () => void;
  onRemoved: () => void;
  onSaved: (section: SiteSection) => void;
  placements: ContentPlacement[] | null;
  saving: boolean;
  section?: SiteSection;
  sections: SiteSection[];
  setError: (value: string) => void;
  setSaving: (value: boolean) => void;
  siteId: string;
};

function SectionEditor(props: SectionEditorProps) {
  const { section } = props;
  const [name, setName] = useState(section?.name ?? "");
  const [key, setKey] = useState(section?.key ?? "");
  const [parentId, setParentId] = useState(section?.parentId ?? "");
  const [entryId, setEntryId] = useState("");
  const [position, setPosition] = useState("0");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setName(section?.name ?? "");
    setKey(section?.key ?? "");
    setParentId(section?.parentId ?? "");
  }, [section]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.setError("");
    props.setSaving(true);
    try {
      const result = section
        ? await updateSection(props.csrfToken, props.siteId, section.id, {
            name: name.trim(),
            parentId: parentId || null,
          })
        : await createSection(props.csrfToken, props.siteId, {
            key: key.trim(),
            name: name.trim(),
            parentId: parentId || null,
          });
      props.onSaved(result);
    } catch (reason) {
      props.setError(siteStructureErrorMessage(reason));
    } finally {
      props.setSaving(false);
    }
  }

  async function remove() {
    if (!section || !window.confirm(`Delete section “${section.name}”?`)) return;
    props.setSaving(true);
    try {
      await deleteSection(props.csrfToken, props.siteId, section.id);
      props.onRemoved();
    } catch (reason) {
      props.setError(siteStructureErrorMessage(reason));
    } finally {
      props.setSaving(false);
    }
  }

  async function placeEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!section || !entryId) return;
    props.setSaving(true);
    try {
      await savePlacement(props.csrfToken, props.siteId, section.id, entryId, {
        isPrimary,
        isVisible,
        position: Number(position),
      });
      setEntryId("");
      props.onPlacementsMutated();
    } catch (reason) {
      props.setError(siteStructureErrorMessage(reason));
    } finally {
      props.setSaving(false);
    }
  }

  async function removePlacement(contentEntryId: string) {
    if (!section) return;
    props.setSaving(true);
    try {
      await deletePlacement(props.csrfToken, props.siteId, section.id, contentEntryId);
      props.onPlacementsMutated();
    } catch (reason) {
      props.setError(siteStructureErrorMessage(reason));
    } finally {
      props.setSaving(false);
    }
  }

  const availableEntries = props.entries.filter(
    (entry) => !props.placements?.some((placement) => placement.contentEntryId === entry.id),
  );

  return (
    <>
      <div className="detail-header structure-detail-header">
        <div>
          <h3>{section ? section.name : "New section"}</h3>
          <p>{section ? section.key : "Create a delivery grouping."}</p>
        </div>
      </div>
      <form className="editor-form structure-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-columns">
          <label>
            Name
            <input
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label>
            Key
            <input
              disabled={Boolean(section)}
              maxLength={80}
              onChange={(event) => setKey(event.target.value)}
              pattern="[a-z][a-z0-9-]*"
              required
              value={key}
            />
          </label>
          <label>
            Parent section
            <select onChange={(event) => setParentId(event.target.value)} value={parentId}>
              <option value="">None</option>
              {props.sections
                .filter((candidate) => candidate.id !== section?.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {props.canWrite ? (
          <div className="form-actions">
            {section ? (
              <button className="button button-danger" onClick={() => void remove()} type="button">
                <Trash2 aria-hidden="true" /> Delete
              </button>
            ) : null}
            <button className="button button-primary" disabled={props.saving}>
              {props.saving ? (
                <LoaderCircle aria-hidden="true" className="spin" />
              ) : (
                <Save aria-hidden="true" />
              )}
              Save section
            </button>
          </div>
        ) : null}
      </form>
      {section ? (
        <section className="structure-subsection" aria-labelledby="placements-title">
          <div className="subsection-heading">
            <div>
              <h3 id="placements-title">Placed entries</h3>
              <p>Control ordering and public visibility in this section.</p>
            </div>
          </div>
          {props.placements === null ? <Loading>Loading placements</Loading> : null}
          {props.placements?.map((placement) => (
            <div className="compact-row placement-row" key={placement.id}>
              <FileInput aria-hidden="true" size={17} />
              <span>
                <strong>{entryLabel(props.entries, placement.contentEntryId)}</strong>
                <small>
                  Position {placement.position} · {placement.isVisible ? "Visible" : "Hidden"}
                  {placement.isPrimary ? " · Primary" : ""}
                </small>
              </span>
              {props.canWrite ? (
                <button
                  aria-label={`Remove ${entryLabel(props.entries, placement.contentEntryId)}`}
                  className="icon-button danger-button"
                  onClick={() => void removePlacement(placement.contentEntryId)}
                  title="Remove placement"
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {props.placements?.length === 0 ? (
            <p className="empty-state compact-empty">No entries placed.</p>
          ) : null}
          {props.canWrite ? (
            <form className="inline-structure-form" onSubmit={(event) => void placeEntry(event)}>
              <label className="wide-control">
                Entry
                <select
                  onChange={(event) => setEntryId(event.target.value)}
                  required
                  value={entryId}
                >
                  <option value="">Select entry</option>
                  {availableEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entryLabel(props.entries, entry.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Position
                <input
                  min={0}
                  onChange={(event) => setPosition(event.target.value)}
                  type="number"
                  value={position}
                />
              </label>
              <label className="checkbox-label">
                <input
                  checked={isVisible}
                  onChange={(event) => setIsVisible(event.target.checked)}
                  type="checkbox"
                />{" "}
                Visible
              </label>
              <label className="checkbox-label">
                <input
                  checked={isPrimary}
                  onChange={(event) => setIsPrimary(event.target.checked)}
                  type="checkbox"
                />{" "}
                Primary
              </label>
              <button
                className="button button-secondary compact-button"
                disabled={props.saving || !entryId}
              >
                <Plus aria-hidden="true" /> Place entry
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function RoutesPanel({ canWrite, context, csrfToken, siteId }: Props) {
  const [routes, setRoutes] = useState<SiteRoute[] | null>(null);
  const [entries, setEntries] = useState<ContentEntrySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    setRoutes(null);
    setError("");
    void Promise.all([listRoutes(siteId), listContentEntries(siteId)])
      .then(([routePage, entryPage]) => {
        setRoutes(routePage.items);
        setEntries(entryPage.items);
      })
      .catch((reason: unknown) => setError(siteStructureErrorMessage(reason)));
  }
  useEffect(load, [siteId]);
  const selected = routes?.find((route) => route.id === selectedId);

  return (
    <div className="master-detail-layout structure-layout">
      <section className="resource-list" aria-label="Routes">
        <div className="resource-list-toolbar">
          <strong>Routes</strong>
          {canWrite ? (
            <button
              aria-label="New route"
              className="icon-button"
              onClick={() => setSelectedId("new")}
              title="New route"
              type="button"
            >
              <Plus aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {routes === null ? <Loading>Loading routes</Loading> : null}
        {routes?.map((route) => (
          <button
            aria-current={selectedId === route.id ? "true" : undefined}
            className="resource-row"
            key={route.id}
            onClick={() => setSelectedId(route.id)}
            type="button"
          >
            <Link2 aria-hidden="true" size={18} />
            <span>
              <strong>{route.path.path}</strong>
              <small>
                {route.locale.code} · {entryLabel(entries, route.contentEntryId)}
              </small>
            </span>
          </button>
        ))}
        {routes?.length === 0 ? <p className="empty-state compact-empty">No routes yet.</p> : null}
      </section>
      <section className="detail-panel" aria-label="Route editor">
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {selectedId ? (
          <RouteEditor
            canWrite={canWrite}
            context={context}
            csrfToken={csrfToken}
            entries={entries}
            onClose={() => setSelectedId(null)}
            onMutated={load}
            route={selected}
            saving={saving}
            setError={setError}
            setSaving={setSaving}
            siteId={siteId}
          />
        ) : (
          <div className="blank-state">
            <Map aria-hidden="true" />
            <h3>Select a route</h3>
            <p>Connect a public path to an entry.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function RouteEditor({
  canWrite,
  context,
  csrfToken,
  entries,
  onClose,
  onMutated,
  route,
  saving,
  setError,
  setSaving,
  siteId,
}: Props & {
  entries: ContentEntrySummary[];
  onClose: () => void;
  onMutated: () => void;
  route?: SiteRoute;
  saving: boolean;
  setError: (value: string) => void;
  setSaving: (value: boolean) => void;
}) {
  const [path, setPath] = useState(route?.path.path ?? "/");
  const [localeId, setLocaleId] = useState(
    route?.locale.id ??
      context.locales.find((locale) => locale.isDefault)?.id ??
      context.locales[0]?.id ??
      "",
  );
  const [contentEntryId, setContentEntryId] = useState(route?.contentEntryId ?? "");
  useEffect(() => {
    setPath(route?.path.path ?? "/");
    setLocaleId(
      route?.locale.id ??
        context.locales.find((locale) => locale.isDefault)?.id ??
        context.locales[0]?.id ??
        "",
    );
    setContentEntryId(route?.contentEntryId ?? "");
  }, [context.locales, route]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (route)
        await updateRoute(csrfToken, siteId, route.id, {
          contentEntryId: contentEntryId || null,
          path,
        });
      else
        await createRoute(csrfToken, siteId, {
          contentEntryId: contentEntryId || null,
          localeId,
          path,
        });
      onMutated();
      onClose();
    } catch (reason) {
      setError(siteStructureErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!route || !window.confirm(`Delete route “${route.path.path}”?`)) return;
    setSaving(true);
    try {
      await deleteRoute(csrfToken, siteId, route.id);
      onMutated();
      onClose();
    } catch (reason) {
      setError(siteStructureErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="editor-form structure-form" onSubmit={(event) => void submit(event)}>
      <div className="detail-header structure-detail-header">
        <div>
          <h3>{route ? route.path.path : "New route"}</h3>
          <p>Public path and content target.</p>
        </div>
      </div>
      <div className="form-grid two-columns">
        <label>
          Path
          <input
            onChange={(event) => setPath(event.target.value)}
            pattern="/(?:[a-z0-9]+(?:-[a-z0-9]+)*/)*[a-z0-9]*(?:-[a-z0-9]+)*"
            required
            value={path}
          />
        </label>
        <label>
          Locale
          <select
            disabled={Boolean(route)}
            onChange={(event) => setLocaleId(event.target.value)}
            required
            value={localeId}
          >
            {context.locales.map((locale) => (
              <option key={locale.id} value={locale.id}>
                {locale.code}
                {locale.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="wide-control">
          Content entry
          <select
            onChange={(event) => setContentEntryId(event.target.value)}
            value={contentEntryId}
          >
            <option value="">No entry</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entryLabel(entries, entry.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {route?.aliases.length ? (
        <p className="structure-meta">
          Aliases: {route.aliases.map((alias) => alias.path.path).join(", ")}
        </p>
      ) : null}
      {canWrite ? (
        <div className="form-actions">
          {route ? (
            <button className="button button-danger" onClick={() => void remove()} type="button">
              <Trash2 aria-hidden="true" /> Delete
            </button>
          ) : null}
          <button className="button button-primary" disabled={saving}>
            <Save aria-hidden="true" /> Save route
          </button>
        </div>
      ) : null}
    </form>
  );
}

function MenusPanel({ canWrite, context, csrfToken, siteId }: Props) {
  const [menus, setMenus] = useState<SiteMenu[] | null>(null);
  const [routes, setRoutes] = useState<SiteRoute[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [error, setError] = useState("");
  function load() {
    setMenus(null);
    setError("");
    void Promise.all([listMenus(siteId), listRoutes(siteId)])
      .then(([menuPage, routePage]) => {
        setMenus(menuPage.items);
        setRoutes(routePage.items);
      })
      .catch((reason: unknown) => setError(siteStructureErrorMessage(reason)));
  }
  useEffect(load, [siteId]);
  const selected = menus?.find((menu) => menu.id === selectedId);
  return (
    <div className="master-detail-layout structure-layout">
      <section className="resource-list" aria-label="Menus">
        <div className="resource-list-toolbar">
          <strong>Menus</strong>
          {canWrite ? (
            <button
              aria-label="New menu"
              className="icon-button"
              onClick={() => setSelectedId("new")}
              title="New menu"
              type="button"
            >
              <Plus aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {menus === null ? <Loading>Loading menus</Loading> : null}
        {menus?.map((menu) => (
          <button
            aria-current={selectedId === menu.id ? "true" : undefined}
            className="resource-row"
            key={menu.id}
            onClick={() => setSelectedId(menu.id)}
            type="button"
          >
            <ListTree aria-hidden="true" size={18} />
            <span>
              <strong>{menu.name}</strong>
              <small>
                {menu.key} · {menu.locale.code}
              </small>
            </span>
          </button>
        ))}
        {menus?.length === 0 ? <p className="empty-state compact-empty">No menus yet.</p> : null}
      </section>
      <section className="detail-panel" aria-label="Menu editor">
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {selectedId ? (
          <MenuEditor
            canWrite={canWrite}
            context={context}
            csrfToken={csrfToken}
            menu={selected}
            onClose={() => setSelectedId(null)}
            onMutated={load}
            routes={routes}
            setError={setError}
            siteId={siteId}
          />
        ) : (
          <div className="blank-state">
            <ListTree aria-hidden="true" />
            <h3>Select a menu</h3>
            <p>Build navigation from internal routes or external links.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function MenusItems({
  canWrite,
  csrfToken,
  menu,
  routes,
  setError,
  siteId,
}: {
  canWrite: boolean;
  csrfToken: string;
  menu: SiteMenu;
  routes: SiteRoute[];
  setError: (value: string) => void;
  siteId: string;
}) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  function load() {
    setItems(null);
    void listMenuItems(siteId, menu.id)
      .then((page) => setItems(page.items))
      .catch((reason: unknown) => setError(siteStructureErrorMessage(reason)));
  }
  useEffect(load, [menu.id, siteId]);
  const selected = items?.find((item) => item.id === selectedId);
  return (
    <section className="structure-subsection" aria-labelledby="menu-items-title">
      <div className="subsection-heading">
        <div>
          <h3 id="menu-items-title">Menu items</h3>
          <p>Order visible links for this locale.</p>
        </div>
        {canWrite ? (
          <button
            className="button button-secondary compact-button"
            onClick={() => setSelectedId("new")}
            type="button"
          >
            <Plus aria-hidden="true" /> Add item
          </button>
        ) : null}
      </div>
      {items === null ? <Loading>Loading menu items</Loading> : null}
      {items?.map((item) => (
        <button
          aria-current={selectedId === item.id ? "true" : undefined}
          className="compact-row compact-row-button"
          key={item.id}
          onClick={() => setSelectedId(item.id)}
          type="button"
        >
          <Link2 aria-hidden="true" size={17} />
          <span>
            <strong>{item.label}</strong>
            <small>
              {item.linkType === "INTERNAL" ? item.route?.path.path : item.externalUrl} · position{" "}
              {item.position}
              {item.isVisible ? "" : " · hidden"}
            </small>
          </span>
        </button>
      ))}
      {items?.length === 0 ? <p className="empty-state compact-empty">No menu items yet.</p> : null}
      {selectedId ? (
        <MenuItemEditor
          canWrite={canWrite}
          csrfToken={csrfToken}
          item={selected}
          items={items ?? []}
          menu={menu}
          onClose={() => setSelectedId(null)}
          onMutated={load}
          routes={routes}
          setError={setError}
          siteId={siteId}
        />
      ) : null}
    </section>
  );
}

function MenuEditor({
  canWrite,
  context,
  csrfToken,
  menu,
  onClose,
  onMutated,
  routes,
  setError,
  siteId,
}: Props & {
  menu?: SiteMenu;
  onClose: () => void;
  onMutated: () => void;
  routes: SiteRoute[];
  setError: (value: string) => void;
}) {
  const [name, setName] = useState(menu?.name ?? "");
  const [key, setKey] = useState(menu?.key ?? "");
  const [localeId, setLocaleId] = useState(
    menu?.locale.id ??
      context.locales.find((locale) => locale.isDefault)?.id ??
      context.locales[0]?.id ??
      "",
  );
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(menu?.name ?? "");
    setKey(menu?.key ?? "");
    setLocaleId(
      menu?.locale.id ??
        context.locales.find((locale) => locale.isDefault)?.id ??
        context.locales[0]?.id ??
        "",
    );
  }, [context.locales, menu]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (menu) await updateMenu(csrfToken, siteId, menu.id, { name: name.trim() });
      else await createMenu(csrfToken, siteId, { key: key.trim(), localeId, name: name.trim() });
      onMutated();
      onClose();
    } catch (reason) {
      setError(siteStructureErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!menu || !window.confirm(`Delete menu “${menu.name}”?`)) return;
    setSaving(true);
    try {
      await deleteMenu(csrfToken, siteId, menu.id);
      onMutated();
      onClose();
    } catch (reason) {
      setError(siteStructureErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <form className="editor-form structure-form" onSubmit={(event) => void submit(event)}>
        <div className="detail-header structure-detail-header">
          <div>
            <h3>{menu ? menu.name : "New menu"}</h3>
            <p>Locale-specific public navigation.</p>
          </div>
        </div>
        <div className="form-grid two-columns">
          <label>
            Name
            <input
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label>
            Key
            <input
              disabled={Boolean(menu)}
              onChange={(event) => setKey(event.target.value)}
              pattern="[a-z][a-z0-9-]*"
              required
              value={key}
            />
          </label>
          <label>
            Locale
            <select
              disabled={Boolean(menu)}
              onChange={(event) => setLocaleId(event.target.value)}
              required
              value={localeId}
            >
              {context.locales.map((locale) => (
                <option key={locale.id} value={locale.id}>
                  {locale.code}
                  {locale.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {canWrite ? (
          <div className="form-actions">
            {menu ? (
              <button className="button button-danger" onClick={() => void remove()} type="button">
                <Trash2 aria-hidden="true" /> Delete
              </button>
            ) : null}
            <button className="button button-primary" disabled={saving}>
              <Save aria-hidden="true" /> Save menu
            </button>
          </div>
        ) : null}
      </form>
      {menu ? (
        <MenusItems
          canWrite={canWrite}
          csrfToken={csrfToken}
          menu={menu}
          routes={routes.filter((route) => route.locale.id === menu.locale.id)}
          setError={setError}
          siteId={siteId}
        />
      ) : null}
    </>
  );
}

function MenuItemEditor({
  canWrite,
  csrfToken,
  item,
  items,
  menu,
  onClose,
  onMutated,
  routes,
  setError,
  siteId,
}: {
  canWrite: boolean;
  csrfToken: string;
  item?: MenuItem;
  items: MenuItem[];
  menu: SiteMenu;
  onClose: () => void;
  onMutated: () => void;
  routes: SiteRoute[];
  setError: (value: string) => void;
  siteId: string;
}) {
  const [draft, setDraft] = useState<MenuItemInput>({
    externalUrl: item?.externalUrl ?? null,
    isVisible: item?.isVisible ?? true,
    label: item?.label ?? "",
    linkType: item?.linkType ?? "INTERNAL",
    parentId: item?.parentId ?? null,
    position: item?.position ?? 0,
    routeId: item?.routeId ?? null,
  });
  const [saving, setSaving] = useState(false);
  useEffect(
    () =>
      setDraft({
        externalUrl: item?.externalUrl ?? null,
        isVisible: item?.isVisible ?? true,
        label: item?.label ?? "",
        linkType: item?.linkType ?? "INTERNAL",
        parentId: item?.parentId ?? null,
        position: item?.position ?? 0,
        routeId: item?.routeId ?? null,
      }),
    [item],
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const input = {
      ...draft,
      externalUrl: draft.linkType === "EXTERNAL" ? draft.externalUrl : null,
      routeId: draft.linkType === "INTERNAL" ? draft.routeId : null,
    };
    try {
      if (item) await updateMenuItem(csrfToken, siteId, menu.id, item.id, input);
      else await createMenuItem(csrfToken, siteId, menu.id, input);
      onMutated();
      onClose();
    } catch (reason) {
      setError(siteStructureErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!item || !window.confirm(`Delete menu item “${item.label}”?`)) return;
    setSaving(true);
    try {
      await deleteMenuItem(csrfToken, siteId, menu.id, item.id);
      onMutated();
      onClose();
    } catch (reason) {
      setError(siteStructureErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="menu-item-form" onSubmit={(event) => void submit(event)}>
      <div className="form-grid two-columns">
        <label>
          Label
          <input
            maxLength={160}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
            required
            value={draft.label}
          />
        </label>
        <label>
          Link type
          <select
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                linkType: event.target.value as MenuItemInput["linkType"],
              }))
            }
            value={draft.linkType}
          >
            <option value="INTERNAL">Internal route</option>
            <option value="EXTERNAL">External URL</option>
          </select>
        </label>
        {draft.linkType === "INTERNAL" ? (
          <label className="wide-control">
            Route
            <select
              onChange={(event) =>
                setDraft((current) => ({ ...current, routeId: event.target.value || null }))
              }
              required
              value={draft.routeId ?? ""}
            >
              <option value="">Select route</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.path.path}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="wide-control">
            External URL
            <input
              onChange={(event) =>
                setDraft((current) => ({ ...current, externalUrl: event.target.value || null }))
              }
              placeholder="https://example.com"
              required
              type="url"
              value={draft.externalUrl ?? ""}
            />
          </label>
        )}
        <label>
          Parent item
          <select
            onChange={(event) =>
              setDraft((current) => ({ ...current, parentId: event.target.value || null }))
            }
            value={draft.parentId ?? ""}
          >
            <option value="">None</option>
            {items
              .filter((candidate) => candidate.id !== item?.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Position
          <input
            min={0}
            onChange={(event) =>
              setDraft((current) => ({ ...current, position: Number(event.target.value) }))
            }
            type="number"
            value={draft.position}
          />
        </label>
        <label className="checkbox-label">
          <input
            checked={draft.isVisible}
            onChange={(event) =>
              setDraft((current) => ({ ...current, isVisible: event.target.checked }))
            }
            type="checkbox"
          />{" "}
          Visible
        </label>
      </div>
      {canWrite ? (
        <div className="form-actions">
          {item ? (
            <button className="button button-danger" onClick={() => void remove()} type="button">
              <Trash2 aria-hidden="true" /> Delete
            </button>
          ) : null}
          <button className="button button-primary" disabled={saving}>
            <Save aria-hidden="true" /> Save item
          </button>
        </div>
      ) : null}
    </form>
  );
}
