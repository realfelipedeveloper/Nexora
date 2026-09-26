import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

export type MediaObject = {
  body: Readable;
  contentLength?: number;
  contentType?: string;
  etag?: string;
};

export interface MediaStorage {
  delete(storageKey: string): Promise<void>;
  get(storageKey: string): Promise<MediaObject>;
  put(input: {
    checksumSha256: string;
    contentType: string;
    filePath: string;
    sizeBytes: number;
    storageKey: string;
  }): Promise<void>;
}

function requiredProductionValue(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new TypeError(`${name} must be explicitly configured in production.`);
  }
  return fallback;
}

@Injectable()
export class S3MediaStorage implements MediaStorage, OnApplicationShutdown {
  private readonly bucket = requiredProductionValue("MINIO_BUCKET", "nexora-media");
  private readonly client: S3Client;
  private bucketReady?: Promise<void>;

  constructor() {
    const endpoint = new URL(requiredProductionValue("MINIO_ENDPOINT", "http://127.0.0.1:48160"));
    if (!new Set(["http:", "https:"]).has(endpoint.protocol)) {
      throw new TypeError("MINIO_ENDPOINT must use HTTP or HTTPS.");
    }
    this.client = new S3Client({
      credentials: {
        accessKeyId: requiredProductionValue("MINIO_ACCESS_KEY", "nexora"),
        secretAccessKey: requiredProductionValue("MINIO_SECRET_KEY", "nexora_dev_password"),
      },
      endpoint: endpoint.toString(),
      forcePathStyle: true,
      region: process.env.MINIO_REGION?.trim() || "us-east-1",
    });
  }

  async put(input: {
    checksumSha256: string;
    contentType: string;
    filePath: string;
    sizeBytes: number;
    storageKey: string;
  }) {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Body: createReadStream(input.filePath),
        Bucket: this.bucket,
        ContentLength: input.sizeBytes,
        ContentType: input.contentType,
        Key: input.storageKey,
        Metadata: { sha256: input.checksumSha256 },
      }),
    );
  }

  async get(storageKey: string): Promise<MediaObject> {
    await this.ensureBucket();
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
    if (!(object.Body instanceof Readable)) {
      throw new TypeError("Object storage returned a non-streaming response.");
    }
    return {
      body: object.Body,
      contentLength: object.ContentLength,
      contentType: object.ContentType,
      etag: object.ETag?.replaceAll('"', ""),
    };
  }

  async delete(storageKey: string) {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }

  onApplicationShutdown() {
    this.client.destroy();
  }

  private ensureBucket() {
    this.bucketReady ??= this.initializeBucket();
    return this.bucketReady;
  }

  private async initializeBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 404 && (error as { name?: string }).name !== "NotFound") throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}
