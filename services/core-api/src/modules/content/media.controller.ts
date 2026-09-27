import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  PreconditionFailedException,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionCsrfGuard } from "../identity/administrative-guards.js";
import {
  SessionAuthenticationGuard,
  type AuthenticatedRequest,
} from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
  type SiteScopedRequest,
} from "../identity/site-authorization.guard.js";
import { MalwareDetectedError, MalwareScannerUnavailableError } from "./malware-scanner.js";
import {
  AssetInUseError,
  AssetNotFoundError,
  AssetPreconditionFailedError,
  InvalidMediaInputError,
  InvalidMediaPageError,
  MediaService,
  UnsupportedAssetTypeError,
} from "./media.service.js";
import {
  InvalidMediaUploadError,
  MediaUploadTooLargeError,
  receiveMediaUpload,
} from "./media-upload.js";

function requestIdentity(request: AuthenticatedRequest) {
  if (!request.identity) throw new ForbiddenException("Authentication required.");
  return request.identity;
}

function versionHeader(value: string | undefined) {
  const match = value?.match(/^"([1-9][0-9]*)"$/u);
  if (!match) throw new BadRequestException("A valid If-Match version is required.");
  return Number(match[1]);
}

function handleMediaError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error instanceof AssetNotFoundError) throw new NotFoundException("Asset not found.");
  if (error instanceof AssetInUseError) throw new ConflictException("Asset is still in use.");
  if (error instanceof AssetPreconditionFailedError) {
    throw new PreconditionFailedException("Asset version no longer matches.");
  }
  if (error instanceof MediaUploadTooLargeError) {
    throw new PayloadTooLargeException("Asset exceeds the 20 MiB limit.");
  }
  if (error instanceof UnsupportedAssetTypeError) {
    throw new UnsupportedMediaTypeException("The detected file type is not allowed.");
  }
  if (error instanceof MalwareDetectedError) {
    throw new BadRequestException("The uploaded file did not pass malware scanning.");
  }
  if (error instanceof MalwareScannerUnavailableError) {
    throw new ServiceUnavailableException("Malware scanning is unavailable.");
  }
  if (
    error instanceof InvalidMediaInputError ||
    error instanceof InvalidMediaUploadError ||
    error instanceof InvalidMediaPageError
  ) {
    throw new BadRequestException("Invalid media request.");
  }
  throw error;
}

@Controller("sites/:siteId/assets")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @RequireSitePermissions("media.read")
  async list(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("q") query?: string,
  ) {
    try {
      return await this.media.list(siteId, { cursor, limit, query });
    } catch (error) {
      handleMediaError(error);
    }
  }

  @Post()
  @Header("Cache-Control", "private, no-store")
  @RequireSitePermissions("media.write")
  @UseGuards(SessionCsrfGuard)
  async upload(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Req() request: Request & SiteScopedRequest,
  ) {
    const identity = requestIdentity(request);
    let upload;
    try {
      upload = await receiveMediaUpload(request);
      return await this.media.upload(identity.user.id, siteId, upload);
    } catch (error) {
      handleMediaError(error);
    } finally {
      await upload?.cleanup();
    }
  }

  @Get(":assetId")
  @Header("Cache-Control", "private, no-store")
  @RequireSitePermissions("media.read")
  async get(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    try {
      return await this.media.get(siteId, assetId);
    } catch (error) {
      handleMediaError(error);
    }
  }

  @Get(":assetId/content")
  @RequireSitePermissions("media.read")
  async content(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Query("v") rawVersion: string | undefined,
    @Res() response: Response,
  ) {
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) throw new NotFoundException("Asset not found.");
    try {
      const result = await this.media.readBySiteId(siteId, assetId, version);
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", result.asset.mimeType);
      response.setHeader("Content-Length", result.asset.sizeBytes);
      response.setHeader("ETag", `"sha256-${result.asset.checksumSha256}"`);
      response.setHeader("X-Content-Type-Options", "nosniff");
      result.object.body.on("error", () => response.destroy());
      result.object.body.pipe(response);
    } catch (error) {
      handleMediaError(error);
    }
  }

  @Get(":assetId/usage")
  @Header("Cache-Control", "private, no-store")
  @RequireSitePermissions("media.read")
  async usage(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    try {
      return { items: await this.media.usage(siteId, assetId) };
    } catch (error) {
      handleMediaError(error);
    }
  }

  @Patch(":assetId")
  @Header("Cache-Control", "private, no-store")
  @RequireSitePermissions("media.write")
  @UseGuards(SessionCsrfGuard)
  async update(
    @Req() request: SiteScopedRequest,
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const asset = await this.media.update(
        requestIdentity(request).user.id,
        siteId,
        assetId,
        versionHeader(ifMatch),
        body,
      );
      return asset;
    } catch (error) {
      handleMediaError(error);
    }
  }

  @Delete(":assetId")
  @HttpCode(204)
  @RequireSitePermissions("media.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: SiteScopedRequest,
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    try {
      await this.media.delete(
        requestIdentity(request).user.id,
        siteId,
        assetId,
        versionHeader(ifMatch),
      );
    } catch (error) {
      handleMediaError(error);
    }
  }
}

@Controller("public/sites/:siteKey/assets")
export class PublicMediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get(":assetId/content")
  async content(
    @Param("siteKey") siteKey: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Query("v") rawVersion: string | undefined,
    @Res() response: Response,
  ) {
    const version = Number(rawVersion);
    if (!/^[a-z][a-z0-9-]{0,62}$/u.test(siteKey) || !Number.isInteger(version) || version < 1) {
      throw new NotFoundException("Asset not found.");
    }
    try {
      const result = await this.media.readBySiteKey(siteKey, assetId, version);
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.setHeader("Content-Type", result.asset.mimeType);
      response.setHeader("Content-Length", result.asset.sizeBytes);
      response.setHeader("ETag", `"sha256-${result.asset.checksumSha256}"`);
      response.setHeader("X-Content-Type-Options", "nosniff");
      result.object.body.on("error", () => response.destroy());
      result.object.body.pipe(response);
    } catch (error) {
      handleMediaError(error);
    }
  }
}
