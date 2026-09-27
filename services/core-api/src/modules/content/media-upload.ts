import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import type { Request } from "express";

export const maximumAssetBytes = 20 * 1024 * 1024;

export type ReceivedUpload = {
  cleanup: () => Promise<void>;
  declaredMimeType: string;
  filePath: string;
  originalName: string;
};

export class InvalidMediaUploadError extends Error {
  override readonly name = "InvalidMediaUploadError";
}

export class MediaUploadTooLargeError extends Error {
  override readonly name = "MediaUploadTooLargeError";
}

function safeOriginalName(value: string) {
  const candidate = Array.from(basename(value))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return Array.from(candidate || "upload")
    .slice(0, 255)
    .join("");
}

export async function receiveMediaUpload(request: Request): Promise<ReceivedUpload> {
  const directory = await mkdtemp(join(tmpdir(), "nexora-media-"));
  const filePath = join(directory, "payload");
  const cleanup = () => rm(directory, { force: true, recursive: true });

  try {
    const result = await new Promise<Omit<ReceivedUpload, "cleanup">>((resolve, reject) => {
      let declaredMimeType = "";
      let fileCount = 0;
      let originalName = "";
      let tooLarge = false;
      let writePromise: Promise<void> | undefined;

      let parser: ReturnType<typeof Busboy>;
      try {
        parser = Busboy({
          headers: request.headers,
          limits: { fields: 0, fileSize: maximumAssetBytes, files: 1, parts: 1 },
        });
      } catch {
        reject(new InvalidMediaUploadError("A multipart file is required."));
        return;
      }

      parser.on("file", (_field, stream, info) => {
        fileCount += 1;
        originalName = safeOriginalName(info.filename);
        declaredMimeType = info.mimeType.toLowerCase();
        stream.on("limit", () => {
          tooLarge = true;
        });
        writePromise = pipeline(stream, createWriteStream(filePath, { flags: "wx" }));
      });
      parser.on("field", () =>
        reject(new InvalidMediaUploadError("Upload fields are not allowed.")),
      );
      parser.on("error", reject);
      parser.on("close", () => {
        void (async () => {
          try {
            await writePromise;
            if (tooLarge) throw new MediaUploadTooLargeError();
            if (fileCount !== 1 || !writePromise) {
              throw new InvalidMediaUploadError("Exactly one file is required.");
            }
            resolve({ declaredMimeType, filePath, originalName });
          } catch (error) {
            reject(error);
          }
        })();
      });
      request.pipe(parser);
    });
    return { ...result, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
