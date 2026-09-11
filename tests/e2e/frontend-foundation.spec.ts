import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("frontend foundation", () => {
  test("public app renders and passes accessibility checks", async ({ page }) => {
    await page.goto("http://127.0.0.1:48110/");

    await expect(
      page.getByRole("heading", { name: "Universal content, site-ready delivery." }),
    ).toBeVisible();
    await expect(page.getByText("ready-for-localhost")).toBeVisible();
    await expect(page.getByText("domain-agnostic")).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("cms app renders field foundation and passes accessibility checks", async ({ page }) => {
    await page.goto("http://127.0.0.1:48111/");

    await expect(page.getByRole("heading", { name: "Content model foundation" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Initial field types" })).toBeVisible();
    await expect(page.getByText("richText")).toBeVisible();
    await expect(page.getByText("multiSelect")).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
