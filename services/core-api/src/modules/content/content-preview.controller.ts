import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { SessionCsrfGuard } from "../identity/administrative-guards.js";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
} from "../identity/site-authorization.guard.js";
import {
  ContentPreviewNotFoundError,
  ContentPreviewService,
  InvalidContentPreviewRequestError,
} from "./content-preview.service.js";
import { AssetNotFoundError, MediaService } from "./media.service.js";

type HeaderResponse = { setHeader: (name: string, value: string) => void };

function previewHeaders(response: HeaderResponse) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Expires", "0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function actorId(request: AuthenticatedRequest) {
  if (!request.identity) throw new HttpException("Authentication required.", 401);
  return request.identity.user.id;
}

function mapPreviewError(error: unknown): never {
  if (error instanceof InvalidContentPreviewRequestError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof ContentPreviewNotFoundError || error instanceof AssetNotFoundError) {
    throw new NotFoundException("Content preview was not found.");
  }
  throw error;
}

@Controller()
export class ContentPreviewController {
  constructor(
    @Inject(ContentPreviewService) private readonly previews: ContentPreviewService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Post("sites/:siteId/content-entries/:contentEntryId/preview-tokens")
  @RequireSitePermissions("content.read")
  @UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard, SessionCsrfGuard)
  async issue(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    previewHeaders(response);
    try {
      return await this.previews.issue(actorId(request), siteId, contentEntryId, body);
    } catch (error) {
      mapPreviewError(error);
    }
  }

  @Get("previews/:token")
  async redeem(
    @Param("token") token: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    previewHeaders(response);
    try {
      return await this.previews.redeem(token);
    } catch (error) {
      mapPreviewError(error);
    }
  }

  @Get("previews/:token/assets/:assetId")
  async asset(
    @Param("token") token: string,
    @Param("assetId", new ParseUUIDPipe({ version: "4" })) assetId: string,
    @Res() response: Response,
  ) {
    previewHeaders(response);
    try {
      const access = await this.previews.authorizeAsset(token, assetId);
      const result = await this.media.readBySiteId(access.siteId, assetId, access.version);
      response.setHeader("Content-Type", result.asset.mimeType);
      response.setHeader("Content-Length", result.asset.sizeBytes);
      response.setHeader("ETag", `"sha256-${result.asset.checksumSha256}"`);
      response.setHeader("X-Content-Type-Options", "nosniff");
      result.object.body.on("error", () => response.destroy());
      result.object.body.pipe(response);
    } catch (error) {
      mapPreviewError(error);
    }
  }
}
