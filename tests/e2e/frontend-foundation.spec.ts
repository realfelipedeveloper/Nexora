import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const webUrl = `http://localhost:${process.env.PLAYWRIGHT_WEB_PORT ?? "48110"}`;
const cmsUrl = `http://localhost:${process.env.PLAYWRIGHT_CMS_PORT ?? "48111"}`;
const csrfToken = "a".repeat(43);
const authenticatedSession = {
  csrfToken,
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: {
    displayName: "Nexora Admin",
    email: "admin@example.com",
    id: "user-1",
    isSystemAdmin: true,
  },
};

test.describe("frontend foundation", () => {
  test("public app renders and passes accessibility checks", async ({ page }) => {
    const identityRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/core") || pathname.startsWith("/auth")) {
        identityRequests.push(pathname);
      }
    });
    const publicResponse = await page.goto(webUrl);

    await expect(
      page.getByRole("heading", { name: "Universal content, site-ready delivery." }),
    ).toBeVisible();
    await expect(page.getByText("ready-for-localhost")).toBeVisible();
    await expect(page.getByText("domain-agnostic")).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    const publicDocument = await page.locator("html").textContent();
    const browserStorage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));

    expect(accessibilityScanResults.violations).toEqual([]);
    expect(publicResponse?.headers()["set-cookie"]).toBeUndefined();
    expect(await page.context().cookies(webUrl)).toEqual([]);
    expect(identityRequests).toEqual([]);
    expect(publicDocument).not.toMatch(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/u);
    expect(publicDocument).not.toContain("nexora_session");
    expect(browserStorage).toEqual({ local: [], session: [] });
  });

  test("cms login is keyboard accessible and keeps credential failures generic", async ({
    page,
  }) => {
    await page.route("**/api/core/auth/session", async (route) => {
      await route.fulfill({ json: { message: "Authentication required." }, status: 401 });
    });
    await page.route("**/api/core/auth/login", async (route) => {
      await route.fulfill({ json: { message: "Invalid email or password." }, status: 401 });
    });
    await page.goto(cmsUrl);

    await expect(page.getByRole("heading", { name: "Nexora" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.getByLabel("Email").fill("unknown@example.com");
    await page.getByLabel("Password", { exact: true }).fill("not the correct password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }),
    ).toHaveText("Email or password is incorrect.");

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("cms signs in without exposing credentials outside the request body", async ({ page }) => {
    let loginBody: unknown;
    let loginUrl = "";
    let authorizationHeader: string | undefined;
    await page.route("**/api/core/auth/session", async (route) => {
      await route.fulfill({ json: { message: "Authentication required." }, status: 401 });
    });
    await page.route("**/api/core/auth/login", async (route) => {
      loginBody = route.request().postDataJSON();
      loginUrl = route.request().url();
      authorizationHeader = route.request().headers().authorization;
      await route.fulfill({ json: authenticatedSession, status: 200 });
    });
    await page.goto(cmsUrl);

    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(loginBody).toEqual({
      email: "admin@example.com",
      password: "correct horse battery staple",
    });
    expect(loginUrl).not.toContain("admin@example.com");
    expect(loginUrl).not.toContain("correct%20horse");
    expect(authorizationHeader).toBeUndefined();
    expect(await page.locator("html").textContent()).not.toContain(csrfToken);
    expect(
      await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
    ).toEqual({ local: [], session: [] });
  });

  test("cms restores an authenticated workspace and logs out with CSRF", async ({ page }) => {
    let logoutHeader: string | undefined;
    await page.route("**/api/core/auth/session", async (route) => {
      await route.fulfill({ json: authenticatedSession, status: 200 });
    });
    await page.route("**/api/core/auth/logout", async (route) => {
      logoutHeader = route.request().headers()["x-csrf-token"];
      await route.fulfill({ body: "", status: 204 });
    });

    await page.goto(cmsUrl);

    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Nexora Admin")).toBeVisible();
    await expect(page.getByRole("region", { name: "Initial field types" })).toBeVisible();
    await expect(page.getByText("richText")).toBeVisible();
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(logoutHeader).toBe(csrfToken);
  });
});
