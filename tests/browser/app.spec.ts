import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Opt-in live smoke test: creates a disposable account and runs one Firecrawl search.
// It never sends an inquiry.
test("sign-up, search, persisted preferences, and sign-in", async ({ page }) => {
  page.on("pageerror", error => console.log("Browser error:", error.message));
  page.on("console", message => { if (message.type() === "error") console.log("Browser console:", message.text()); });
  const username = `smoke-${Date.now()}`;
  const password = `Apartment-${randomUUID()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Move-in date").fill("2026-11-01");
  await page.getByLabel("Maximum monthly rent").fill("2500");
  await page.getByRole("button", { name: "Find my apartments" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Looking around Ann Arbor…")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Looking around Ann Arbor…")).not.toBeVisible({ timeout: 180000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  const listingCount = await page.locator(".listing-card").count();
  console.log(`Live search returned ${listingCount} potential matches.`);
  if (!listingCount) await expect(page.getByText("No suitable listings in this batch.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "New apartment search" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "New apartment search" }).click();
  await expect(page.getByLabel("Maximum monthly rent")).toHaveValue("2500");
  await expect(page.getByLabel("Move-in date")).toHaveValue("2026-11-01");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "New apartment search" })).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
