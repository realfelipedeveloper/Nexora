"use client";

import {
  createEmptyRichTextDocument,
  createRichTextExtensions,
  isSafeRichTextHref,
  normalizeRichTextDocument,
  richTextPlainText,
  toTiptapDocument,
  type RichTextDocument,
} from "@nexora/rich-text";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import type { MediaAsset } from "./media-api";
import { MediaFieldPicker } from "./media-picker";

type Props = {
  canReadMedia: boolean;
  canWriteMedia: boolean;
  csrfToken: string;
  disabled: boolean;
  label: string;
  onChange: (value: RichTextDocument) => void;
  required: boolean;
  siteId: string;
  value: unknown;
};

function documentValue(value: unknown) {
  try {
    return normalizeRichTextDocument(value ?? createEmptyRichTextDocument());
  } catch {
    return createEmptyRichTextDocument();
  }
}

function ToolButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={active ? "rich-text-tool active" : "rich-text-tool"}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function RichTextToolbar({
  canReadMedia,
  canWriteMedia,
  csrfToken,
  disabled,
  editor,
  siteId,
}: Pick<Props, "canReadMedia" | "canWriteMedia" | "csrfToken" | "disabled" | "siteId"> & {
  editor: Editor;
}) {
  const [editingLink, setEditingLink] = useState(false);
  const [href, setHref] = useState("");
  const [newWindow, setNewWindow] = useState(false);
  const [linkError, setLinkError] = useState("");
  const unavailable = disabled || !editor.can().chain().focus().run();

  function openLinkEditor() {
    const current = editor.getAttributes("link") as { href?: unknown; target?: unknown };
    setHref(typeof current.href === "string" ? current.href : "");
    setNewWindow(current.target === "_blank");
    setLinkError("");
    setEditingLink(true);
  }

  function applyLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextHref = href.trim();
    if (!isSafeRichTextHref(nextHref)) {
      setLinkError("Enter a safe web, email, phone, anchor, or site-relative URL.");
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: nextHref, target: newWindow ? "_blank" : null })
      .run();
    setEditingLink(false);
  }

  function insertAsset(assets: MediaAsset[]) {
    const asset = assets[0];
    if (!asset) return;
    editor
      .chain()
      .focus()
      .insertContent({
        attrs: {
          altText: asset.altText ?? "",
          assetId: asset.id,
          displayName: asset.displayName,
          kind: asset.mimeType.startsWith("image/") ? "image" : "file",
        },
        type: "asset",
      })
      .run();
  }

  return (
    <>
      <div aria-label="Rich text formatting" className="rich-text-toolbar" role="toolbar">
        <div className="rich-text-tool-group">
          <ToolButton
            active={editor.isActive("paragraph")}
            disabled={unavailable}
            label="Paragraph"
            onClick={() => editor.chain().focus().setParagraph().run()}
          >
            <Pilcrow aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("heading", { level: 2 })}
            disabled={unavailable}
            label="Heading level 2"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 aria-hidden="true" />
          </ToolButton>
        </div>
        <div className="rich-text-tool-group">
          <ToolButton
            active={editor.isActive("bold")}
            disabled={unavailable}
            label="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("italic")}
            disabled={unavailable}
            label="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("underline")}
            disabled={unavailable}
            label="Underline"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <Underline aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("strike")}
            disabled={unavailable}
            label="Strikethrough"
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("code")}
            disabled={unavailable}
            label="Inline code"
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code aria-hidden="true" />
          </ToolButton>
        </div>
        <div className="rich-text-tool-group">
          <ToolButton
            active={editor.isActive("bulletList")}
            disabled={unavailable}
            label="Bullet list"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("orderedList")}
            disabled={unavailable}
            label="Numbered list"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("blockquote")}
            disabled={unavailable}
            label="Block quote"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote aria-hidden="true" />
          </ToolButton>
        </div>
        <div className="rich-text-tool-group">
          <ToolButton
            active={editor.isActive("link")}
            disabled={unavailable}
            label="Add or edit link"
            onClick={openLinkEditor}
          >
            <LinkIcon aria-hidden="true" />
          </ToolButton>
          <ToolButton
            disabled={unavailable || !editor.isActive("link")}
            label="Remove link"
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            <Unlink aria-hidden="true" />
          </ToolButton>
          <ToolButton
            disabled={unavailable}
            label="Clear formatting"
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          >
            <RemoveFormatting aria-hidden="true" />
          </ToolButton>
        </div>
        {canReadMedia ? (
          <MediaFieldPicker
            canUpload={canWriteMedia}
            csrfToken={csrfToken}
            disabled={disabled}
            insertMode
            multiple={false}
            onAssetsSelected={insertAsset}
            onChange={() => undefined}
            siteId={siteId}
            value={undefined}
          />
        ) : null}
        <div className="rich-text-tool-group rich-text-history-tools">
          <ToolButton
            disabled={unavailable || !editor.can().chain().focus().undo().run()}
            label="Undo"
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 aria-hidden="true" />
          </ToolButton>
          <ToolButton
            disabled={unavailable || !editor.can().chain().focus().redo().run()}
            label="Redo"
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 aria-hidden="true" />
          </ToolButton>
        </div>
      </div>
      {editingLink ? (
        <form aria-label="Edit link" className="rich-text-link-form" onSubmit={applyLink}>
          <label>
            <span>URL</span>
            <input
              autoFocus
              onChange={(event) => {
                setHref(event.target.value);
                setLinkError("");
              }}
              required
              type="text"
              value={href}
            />
          </label>
          <label className="checkbox-label">
            <input
              checked={newWindow}
              onChange={(event) => setNewWindow(event.target.checked)}
              type="checkbox"
            />
            New window
          </label>
          <button className="button button-primary" type="submit">
            Apply
          </button>
          <button
            className="button button-secondary"
            onClick={() => setEditingLink(false)}
            type="button"
          >
            Cancel
          </button>
          {linkError ? (
            <p className="rich-text-link-error" role="alert">
              {linkError}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}

export function RichTextEditor({
  canReadMedia,
  canWriteMedia,
  csrfToken,
  disabled,
  label,
  onChange,
  required,
  siteId,
  value,
}: Props) {
  const initialDocument = useMemo(() => documentValue(value), [value]);
  const extensions = useMemo(
    () =>
      createRichTextExtensions({
        resolveAssetUrl: (assetId) => `/api/core/sites/${siteId}/assets/${assetId}/content`,
      }),
    [siteId],
  );
  const editor = useEditor({
    content: toTiptapDocument(initialDocument),
    editable: !disabled,
    editorProps: {
      attributes: {
        "aria-label": `${label} rich text`,
        "aria-multiline": "true",
        "aria-required": String(required),
        class: "rich-text-content",
        role: "textbox",
      },
    },
    extensions,
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      const json = activeEditor.getJSON();
      onChange(
        normalizeRichTextDocument({
          content: json.content ?? [{ content: [], type: "paragraph" }],
          schemaVersion: 1,
          type: "doc",
        }),
      );
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const expected = toTiptapDocument(initialDocument);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(expected)) {
      editor.commands.setContent(expected, { emitUpdate: false });
    }
  }, [editor, initialDocument]);

  const textLength = richTextPlainText(initialDocument).length;
  return (
    <div className={disabled ? "rich-text-editor disabled" : "rich-text-editor"}>
      {editor ? (
        <RichTextToolbar
          canReadMedia={canReadMedia}
          canWriteMedia={canWriteMedia}
          csrfToken={csrfToken}
          disabled={disabled}
          editor={editor}
          siteId={siteId}
        />
      ) : null}
      <EditorContent editor={editor} />
      <output aria-live="polite" className="rich-text-count">
        {textLength.toLocaleString()} characters
      </output>
    </div>
  );
}
