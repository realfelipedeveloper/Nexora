import type {
  PublicContentAsset,
  PublicContentEntry,
  PublicNavigationItem,
  PublicNavigationMenu,
  PublicSiteConfiguration,
} from "@nexora/contracts";
import { renderRichTextHtml } from "@nexora/rich-text";
import Image from "next/image";
import Link from "next/link";
import {
  contentHeading,
  contentSummary,
  humanizeKey,
  isRichTextDocument,
  publicAssetPath,
} from "../lib/public-site";

const headingKeys = new Set(["title", "headline", "name", "displayName"]);
const summaryKeys = new Set(["summary", "description", "excerpt", "subtitle"]);

function NavigationItems({ items }: Readonly<{ items: PublicNavigationItem[] }>) {
  return (
    <ul>
      {items.map((item) => {
        const href = item.linkType === "EXTERNAL" ? item.externalUrl : item.path;
        if (!href) return null;
        return (
          <li key={item.id}>
            {item.linkType === "EXTERNAL" ? (
              <a href={href} rel="noopener noreferrer">
                {item.label}
              </a>
            ) : (
              <Link href={href}>{item.label}</Link>
            )}
            {item.children.length > 0 ? <NavigationItems items={item.children} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function SiteHeader({
  brand,
  menu,
}: Readonly<{ brand: string; menu: PublicNavigationMenu | null }>) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-brand" href="/">
          {brand}
        </Link>
        {menu && menu.items.length > 0 ? (
          <nav aria-label={menu.name} className="site-navigation">
            <NavigationItems items={menu.items} />
          </nav>
        ) : null}
      </div>
    </header>
  );
}

function Asset({ asset }: Readonly<{ asset: PublicContentAsset }>) {
  const source = publicAssetPath(asset.id, asset.version);
  if (asset.mimeType.startsWith("image/")) {
    return (
      <figure className="asset-figure">
        <Image
          alt={asset.altText ?? ""}
          height={900}
          priority={false}
          src={source}
          unoptimized
          width={1600}
        />
        {asset.altText ? <figcaption>{asset.altText}</figcaption> : null}
      </figure>
    );
  }
  return (
    <a className="asset-download" href={source}>
      {asset.displayName}
    </a>
  );
}

function RichText({
  assets,
  value,
}: Readonly<{ assets: Map<string, PublicContentAsset>; value: unknown }>) {
  try {
    const html = renderRichTextHtml(value, (assetId) => {
      const asset = assets.get(assetId);
      return asset ? publicAssetPath(asset.id, asset.version) : "#asset-unavailable";
    });
    return <div className="rich-text" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return null;
  }
}

function ScalarValue({ value }: Readonly<{ value: boolean | number | string }>) {
  if (typeof value === "boolean") return <p>{value ? "Sim" : "Não"}</p>;
  if (typeof value === "string" && /^https?:\/\//u.test(value)) {
    return (
      <p>
        <a href={value} rel="noopener noreferrer">
          {value}
        </a>
      </p>
    );
  }
  return <p>{String(value)}</p>;
}

function ContentField({
  assets,
  fieldKey,
  value,
}: Readonly<{
  assets: PublicContentAsset[];
  fieldKey: string;
  value: unknown;
}>) {
  const fieldAssets = assets.filter((asset) => asset.role === fieldKey);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  if (isRichTextDocument(value)) {
    return (
      <section className="content-field">
        <RichText assets={assetsById} value={value} />
      </section>
    );
  }
  if (fieldAssets.length > 0) {
    return (
      <section className="content-field">
        <h2>{humanizeKey(fieldKey)}</h2>
        <div className="asset-list">
          {fieldAssets.map((asset) => (
            <Asset asset={asset} key={asset.id} />
          ))}
        </div>
      </section>
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return (
      <section className="content-field">
        <h2>{humanizeKey(fieldKey)}</h2>
        <ScalarValue value={value} />
      </section>
    );
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => ["boolean", "number", "string"].includes(typeof item))
  ) {
    return (
      <section className="content-field">
        <h2>{humanizeKey(fieldKey)}</h2>
        <ul>
          {value.map((item, index) => (
            <li key={`${String(item)}-${index}`}>{String(item)}</li>
          ))}
        </ul>
      </section>
    );
  }
  return null;
}

export function PublicContent({ content }: Readonly<{ content: PublicContentEntry }>) {
  const title = contentHeading(content);
  const summary = contentSummary(content);
  const fields = Object.entries(content.data).filter(
    ([key, value]) =>
      !headingKeys.has(key) && !summaryKeys.has(key) && value !== null && value !== undefined,
  );

  return (
    <article>
      <header className="content-header">
        <p className="content-kicker">{humanizeKey(content.contentType.key)}</p>
        <h1 className="content-title">{title}</h1>
        {summary ? <p className="content-summary">{summary}</p> : null}
      </header>
      <div className="content-body">
        {fields.map(([key, value]) => (
          <ContentField assets={content.assets} fieldKey={key} key={key} value={value} />
        ))}
      </div>
    </article>
  );
}

export function PublicLayout({
  children,
  configuration,
  menu,
}: Readonly<{
  children: React.ReactNode;
  configuration: PublicSiteConfiguration | null;
  menu: PublicNavigationMenu | null;
}>) {
  const brand =
    configuration?.site.identity?.displayName ?? configuration?.branding?.productName ?? "Nexora";
  return (
    <div className="site-shell">
      <SiteHeader brand={brand} menu={menu} />
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>{brand}</p>
          <p>Conteúdo publicado com Nexora</p>
        </div>
      </footer>
    </div>
  );
}
