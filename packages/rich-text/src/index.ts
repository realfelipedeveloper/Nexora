import { Node, type Extensions, type JSONContent } from "@tiptap/core";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import StarterKit from "@tiptap/starter-kit";
import { z } from "zod";

export const richTextSchemaVersion = 1 as const;
export const maximumRichTextNodes = 5_000;
export const maximumRichTextDepth = 24;
export const maximumRichTextTextLength = 500_000;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const languagePattern = /^[a-z0-9+#.-]{1,32}$/iu;
const nodeTypes = [
  "asset",
  "blockquote",
  "bulletList",
  "codeBlock",
  "hardBreak",
  "heading",
  "horizontalRule",
  "listItem",
  "orderedList",
  "paragraph",
  "text",
] as const;

export type RichTextAssetKind = "file" | "image";
export type RichTextMark =
  | { type: "bold" | "code" | "italic" | "strike" | "underline" }
  | {
      attrs: {
        class?: null;
        href: string;
        rel?: "noopener noreferrer" | null;
        target?: "_blank" | null;
      };
      type: "link";
    };

export type RichTextNode = {
  attrs?: Record<string, null | number | string>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
  type: (typeof nodeTypes)[number];
};

export type RichTextDocument = {
  content: RichTextNode[];
  schemaVersion: typeof richTextSchemaVersion;
  type: "doc";
};

type ParseState = { nodes: number; textLength: number };

const basicMarkSchema = z.strictObject({
  type: z.enum(["bold", "code", "italic", "strike", "underline"]),
});

export function isSafeRichTextHref(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  if (value.startsWith("#")) return /^#[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value);
  try {
    const url = new URL(value);
    if (url.protocol === "mailto:" || url.protocol === "tel:") {
      return url.username === "" && url.password === "";
    }
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

const linkMarkSchema = z
  .strictObject({
    attrs: z.strictObject({
      class: z.null().optional(),
      href: z.string().trim().min(1).max(2_048).refine(isSafeRichTextHref),
      rel: z.union([z.literal("noopener noreferrer"), z.null()]).optional(),
      target: z.union([z.literal("_blank"), z.null()]).optional(),
    }),
    type: z.literal("link"),
  })
  .transform(
    (mark): RichTextMark => ({
      attrs: {
        class: null,
        href: mark.attrs.href,
        rel: "noopener noreferrer",
        target: mark.attrs.target ?? null,
      },
      type: "link",
    }),
  );

const markSchema = z.union([basicMarkSchema, linkMarkSchema]);
const rawNodeSchema = z.strictObject({
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(z.unknown()).max(maximumRichTextNodes).optional(),
  marks: z.array(markSchema).max(16).optional(),
  text: z.string().max(maximumRichTextTextLength).optional(),
  type: z.enum(nodeTypes),
});
const emptyAttrsSchema = z.strictObject({});
const headingAttrsSchema = z.strictObject({
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
});
const codeBlockAttrsSchema = z.strictObject({
  language: z.union([z.string().regex(languagePattern), z.null()]).optional(),
});
const listAttrsSchema = z.strictObject({ type: z.null().optional() });
const orderedListAttrsSchema = z.strictObject({
  start: z.number().int().positive().max(100_000).default(1),
  type: z.null().optional(),
});
const assetAttrsSchema = z.strictObject({
  altText: z.string().trim().max(500).default(""),
  assetId: z.string().regex(uuidPattern),
  caption: z.union([z.string().trim().max(500), z.null()]).optional(),
  displayName: z.string().trim().min(1).max(255),
  kind: z.enum(["file", "image"]),
});

function attributes<T>(value: Record<string, unknown> | undefined, schema: z.ZodType<T>): T {
  return schema.parse(value ?? {});
}

function parseChildren(values: readonly unknown[] | undefined, depth: number, state: ParseState) {
  return (values ?? []).map((value) => parseNode(value, depth + 1, state));
}

function assertChildren(node: RichTextNode, allowed: ReadonlySet<RichTextNode["type"]>) {
  if (node.content?.some((child) => !allowed.has(child.type))) {
    throw new TypeError("Rich text node contains an unsupported child.");
  }
}

const inlineTypes = new Set<RichTextNode["type"]>(["hardBreak", "text"]);
const blockTypes = new Set<RichTextNode["type"]>([
  "asset",
  "blockquote",
  "bulletList",
  "codeBlock",
  "heading",
  "horizontalRule",
  "orderedList",
  "paragraph",
]);

function parseNode(value: unknown, depth: number, state: ParseState): RichTextNode {
  if (depth > maximumRichTextDepth || ++state.nodes > maximumRichTextNodes) {
    throw new TypeError("Rich text document exceeds structural limits.");
  }
  const raw = rawNodeSchema.parse(value);

  switch (raw.type) {
    case "text": {
      attributes(raw.attrs, emptyAttrsSchema);
      if (raw.content || raw.text === undefined || raw.text.length === 0) {
        throw new TypeError("Rich text text nodes require non-empty text only.");
      }
      state.textLength += raw.text.length;
      return { marks: raw.marks, text: raw.text, type: "text" };
    }
    case "hardBreak":
    case "horizontalRule": {
      attributes(raw.attrs, emptyAttrsSchema);
      if (raw.content || raw.marks || raw.text !== undefined) {
        throw new TypeError("Rich text leaf node contains unsupported data.");
      }
      return { type: raw.type };
    }
    case "asset": {
      if (raw.content || raw.marks || raw.text !== undefined) {
        throw new TypeError("Rich text asset node contains unsupported data.");
      }
      return { attrs: attributes(raw.attrs, assetAttrsSchema), type: "asset" };
    }
    case "heading": {
      if (raw.marks || raw.text !== undefined) throw new TypeError("Invalid heading node.");
      const node: RichTextNode = {
        attrs: attributes(raw.attrs, headingAttrsSchema),
        content: parseChildren(raw.content, depth, state),
        type: "heading",
      };
      assertChildren(node, inlineTypes);
      return node;
    }
    case "paragraph": {
      attributes(raw.attrs, emptyAttrsSchema);
      if (raw.marks || raw.text !== undefined) throw new TypeError("Invalid paragraph node.");
      const node: RichTextNode = {
        content: parseChildren(raw.content, depth, state),
        type: "paragraph",
      };
      assertChildren(node, inlineTypes);
      return node;
    }
    case "codeBlock": {
      if (raw.marks || raw.text !== undefined) throw new TypeError("Invalid code block node.");
      const node: RichTextNode = {
        attrs: attributes(raw.attrs, codeBlockAttrsSchema),
        content: parseChildren(raw.content, depth, state),
        type: "codeBlock",
      };
      assertChildren(node, new Set(["text"]));
      return node;
    }
    case "blockquote":
    case "listItem": {
      attributes(raw.attrs, emptyAttrsSchema);
      if (raw.marks || raw.text !== undefined) throw new TypeError("Invalid block node.");
      const node: RichTextNode = {
        content: parseChildren(raw.content, depth, state),
        type: raw.type,
      };
      assertChildren(node, blockTypes);
      return node;
    }
    case "bulletList":
    case "orderedList": {
      if (raw.marks || raw.text !== undefined) throw new TypeError("Invalid list node.");
      const node: RichTextNode = {
        attrs:
          raw.type === "orderedList"
            ? attributes(raw.attrs, orderedListAttrsSchema)
            : attributes(raw.attrs, listAttrsSchema),
        content: parseChildren(raw.content, depth, state),
        type: raw.type,
      };
      assertChildren(node, new Set(["listItem"]));
      return node;
    }
    default:
      return raw.type satisfies never;
  }
}

export const richTextDocumentSchema = z
  .strictObject({
    content: z.array(z.unknown()).max(maximumRichTextNodes),
    schemaVersion: z.literal(richTextSchemaVersion),
    type: z.literal("doc"),
  })
  .transform((document, context): RichTextDocument => {
    try {
      const state = { nodes: 0, textLength: 0 };
      const content = document.content.map((node) => parseNode(node, 1, state));
      if (content.length === 0 || content.some((node) => !blockTypes.has(node.type))) {
        throw new TypeError("Rich text document requires block content.");
      }
      if (state.textLength > maximumRichTextTextLength) {
        throw new TypeError("Rich text document exceeds its text limit.");
      }
      return { content, schemaVersion: richTextSchemaVersion, type: "doc" };
    } catch {
      context.addIssue({ code: "custom", message: "Rich text document is invalid." });
      return z.NEVER;
    }
  });

export function createEmptyRichTextDocument(): RichTextDocument {
  return { content: [{ content: [], type: "paragraph" }], schemaVersion: 1, type: "doc" };
}

function migrateLegacyText(value: string): RichTextDocument {
  const content = value.split(/\r?\n/u).map(
    (line): RichTextNode => ({
      content: line.length > 0 ? [{ text: line, type: "text" }] : [],
      type: "paragraph",
    }),
  );
  return {
    content: content.length > 0 ? content : [{ content: [], type: "paragraph" }],
    schemaVersion: richTextSchemaVersion,
    type: "doc",
  };
}

export function normalizeRichTextDocument(value: unknown): RichTextDocument {
  return richTextDocumentSchema.parse(typeof value === "string" ? migrateLegacyText(value) : value);
}

export function toTiptapDocument(document: RichTextDocument): JSONContent {
  return { content: document.content as JSONContent[], type: "doc" };
}

function walk(document: RichTextDocument, visit: (node: RichTextNode) => void) {
  const pending = [...document.content].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    visit(node);
    if (node.content) pending.push(...[...node.content].reverse());
  }
}

export function richTextPlainText(document: RichTextDocument) {
  const text: string[] = [];
  walk(document, (node) => {
    if (node.type === "text" && node.text) text.push(node.text);
  });
  return text.join(" ");
}

export function richTextAssetIds(document: RichTextDocument) {
  const ids: string[] = [];
  walk(document, (node) => {
    const assetId = node.type === "asset" ? node.attrs?.assetId : undefined;
    if (typeof assetId === "string") ids.push(assetId);
  });
  return ids;
}

type RichTextExtensionOptions = {
  resolveAssetUrl?: (assetId: string) => string;
};

const AssetNode = Node.create<RichTextExtensionOptions>({
  name: "asset",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return { resolveAssetUrl: (assetId) => `#asset-${assetId}` };
  },

  addAttributes() {
    return {
      altText: { default: "" },
      assetId: { default: null },
      caption: { default: null },
      displayName: { default: "Asset" },
      kind: { default: "file" },
    };
  },

  renderHTML({ node }) {
    const assetId = String(node.attrs.assetId);
    const url = this.options.resolveAssetUrl?.(assetId) ?? `#asset-${assetId}`;
    const common = {
      "data-asset-id": assetId,
      "data-nexora-asset": "",
    };
    if (node.attrs.kind === "image") {
      const image = [
        "img",
        { alt: String(node.attrs.altText ?? ""), src: url, title: String(node.attrs.displayName) },
      ];
      return node.attrs.caption
        ? ["figure", common, image, ["figcaption", {}, String(node.attrs.caption)]]
        : ["figure", common, image];
    }
    return [
      "p",
      common,
      [
        "a",
        { href: url, rel: "noopener noreferrer" },
        String(node.attrs.displayName ?? "Download file"),
      ],
    ];
  },
});

export function createRichTextExtensions(options: RichTextExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: {
        HTMLAttributes: { rel: "noopener noreferrer", target: null },
        defaultProtocol: "https",
        isAllowedUri: (url, context) => context.defaultValidate(url) && isSafeRichTextHref(url),
        openOnClick: false,
      },
    }),
    AssetNode.configure(options),
  ];
}

export function renderRichTextHtml(value: unknown, resolveAssetUrl: (assetId: string) => string) {
  const document = normalizeRichTextDocument(value);
  return renderToHTMLString({
    content: toTiptapDocument(document),
    extensions: createRichTextExtensions({ resolveAssetUrl }),
  });
}
