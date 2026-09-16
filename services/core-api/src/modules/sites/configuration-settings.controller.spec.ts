import {
  BadRequestException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  PreconditionFailedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import {
  ConfigurationKeyNotRegisteredError,
  ConfigurationValueTooLargeError,
} from "./configuration-registry.js";
import {
  GlobalSettingsController,
  parseSettingPrecondition,
  SiteSettingsController,
} from "./configuration-settings.controller.js";
import {
  SettingNotFoundError,
  SettingPreconditionFailedError,
  type ConfigurationSettingsService,
} from "./configuration-settings.service.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2026-01-01T01:00:00Z"),
    sessionId: "session-1",
    user: {
      displayName: "Felipe",
      email: "felipe@nexora.local",
      id: "admin-1",
      isSystemAdmin: true,
    },
  },
} satisfies AuthenticatedRequest;

function fixture() {
  const service = {
    getGlobal: vi.fn(),
    getSite: vi.fn(),
    listGlobal: vi.fn(),
    listSite: vi.fn(),
    writeGlobal: vi.fn(),
    writeSite: vi.fn(),
  };
  return {
    global: new GlobalSettingsController(service as unknown as ConfigurationSettingsService),
    response: { setHeader: vi.fn() },
    service,
    site: new SiteSettingsController(service as unknown as ConfigurationSettingsService),
  };
}

describe("configuration settings controllers", () => {
  it("parses creation and version update preconditions", () => {
    expect(parseSettingPrecondition(undefined, "*")).toEqual({ mode: "create" });
    expect(parseSettingPrecondition('"42"', undefined)).toEqual({ mode: "update", version: 42 });
  });

  it.each([
    [undefined, undefined, HttpException],
    ['"1"', "*", BadRequestException],
    ["1", undefined, BadRequestException],
    [undefined, '"*"', BadRequestException],
    ['"9007199254740992"', undefined, BadRequestException],
  ])("rejects missing or malformed preconditions", (ifMatch, ifNoneMatch, expected) => {
    expect(() => parseSettingPrecondition(ifMatch, ifNoneMatch)).toThrow(expected);
  });

  it("returns an ETag for global reads and writes", async () => {
    const { global, response, service } = fixture();
    service.getGlobal.mockResolvedValue({ version: 4 });
    service.writeGlobal.mockResolvedValue({ version: 5 });

    await expect(global.get("platform.branding", response)).resolves.toEqual({ version: 4 });
    expect(response.setHeader).toHaveBeenCalledWith("ETag", '"4"');
    await expect(
      global.write(
        request,
        "platform.branding",
        "application/json",
        '"4"',
        undefined,
        { productName: "Nexora" },
        response,
      ),
    ).resolves.toEqual({ version: 5 });
    expect(service.writeGlobal).toHaveBeenCalledWith(
      "admin-1",
      "platform.branding",
      { productName: "Nexora" },
      { mode: "update", version: 4 },
    );
    expect(response.setHeader).toHaveBeenCalledWith("ETag", '"5"');
  });

  it("keeps site identity in every site-scoped service call", async () => {
    const { response, service, site } = fixture();
    service.getSite.mockResolvedValue({ version: 1 });
    service.writeSite.mockResolvedValue({ version: 2 });

    await site.get("site-1", "site.identity", response);
    expect(service.getSite).toHaveBeenCalledWith("site-1", "site.identity");
    await site.write(
      request,
      "site-1",
      "site.identity",
      "application/json",
      '"1"',
      undefined,
      { displayName: "Main" },
      response,
    );
    expect(service.writeSite).toHaveBeenCalledWith(
      "admin-1",
      "site-1",
      "site.identity",
      { displayName: "Main" },
      { mode: "update", version: 1 },
    );
  });

  it.each([
    [new ConfigurationKeyNotRegisteredError("global"), BadRequestException],
    [new ConfigurationValueTooLargeError(), PayloadTooLargeException],
    [new SettingNotFoundError(), NotFoundException],
    [new SettingPreconditionFailedError(), PreconditionFailedException],
  ])("maps domain failures to bounded HTTP errors", async (failure, expected) => {
    const { global, response, service } = fixture();
    service.getGlobal.mockRejectedValue(failure);
    await expect(global.get("platform.branding", response)).rejects.toBeInstanceOf(expected);
  });

  it("rejects non-JSON mutations before calling the service", async () => {
    const { global, response, service } = fixture();
    await expect(
      global.write(request, "platform.branding", "text/plain", undefined, "*", {}, response),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(service.writeGlobal).not.toHaveBeenCalled();
  });
});
