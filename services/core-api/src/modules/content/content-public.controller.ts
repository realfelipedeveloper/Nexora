import { createHash } from "node:crypto";
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { PublicContentEntry, PublicContentPage } from "@nexora/contracts";
import { InvalidPublicContentQueryError, PublicContentService } from "./content-public.service.js";

type PublicResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => unknown;
};

export const publicContentCacheControl =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=60";

function createEtag(value: PublicContentEntry | PublicContentPage) {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("base64url");
  return `"sha256-${digest}"`;
}

function matchesEtag(ifNoneMatch: string | undefined, etag: string) {
  return Boolean(
    ifNoneMatch
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || candidate === etag || candidate === `W/${etag}`),
  );
}

function publicResponse(
  response: PublicResponse,
  ifNoneMatch: string | undefined,
  value: PublicContentEntry | PublicContentPage,
) {
  const etag = createEtag(value);
  response.setHeader("ETag", etag);
  if (matchesEtag(ifNoneMatch, etag)) {
    response.status(304);
    return undefined;
  }
  return value;
}

function mapPublicContentError(error: unknown): never {
  if (error instanceof InvalidPublicContentQueryError) {
    throw new BadRequestException(error.message);
  }
  throw error;
}

@Controller("public/sites/:siteKey/content")
export class PublicContentController {
  constructor(@Inject(PublicContentService) private readonly content: PublicContentService) {}

  @Get(":contentTypeKey")
  @Header("Cache-Control", publicContentCacheControl)
  async list(
    @Param("siteKey") siteKey: string,
    @Param("contentTypeKey") contentTypeKey: string,
    @Query("locale") locale: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: PublicResponse,
  ) {
    try {
      const page = await this.content.list(siteKey, contentTypeKey, { cursor, limit, locale });
      if (!page) {
        throw new NotFoundException("Public content collection was not found.");
      }
      return publicResponse(response, ifNoneMatch, page);
    } catch (error) {
      mapPublicContentError(error);
    }
  }

  @Get(":contentTypeKey/:entryId")
  @Header("Cache-Control", publicContentCacheControl)
  async get(
    @Param("siteKey") siteKey: string,
    @Param("contentTypeKey") contentTypeKey: string,
    @Param("entryId") entryId: string,
    @Query("locale") locale: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: PublicResponse,
  ) {
    try {
      const entry = await this.content.get(siteKey, contentTypeKey, entryId, locale);
      if (!entry) {
        throw new NotFoundException("Public content entry was not found.");
      }
      return publicResponse(response, ifNoneMatch, entry);
    } catch (error) {
      mapPublicContentError(error);
    }
  }
}
