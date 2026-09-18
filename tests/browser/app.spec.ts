import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Preferences } from "../../convex/schema";

const savedPreferences: Preferences = {
  city: "Ann Arbor, Michigan", minRent: 800, maxRent: 2000, moveIn: "2026-11-01", notes: "Quiet building",
  bedrooms: { values: [1, 2], weight: "must" }, bathrooms: { values: [2], weight: "want" }, floors: { values: [3], weight: "nice" },
  sqft: { min: 700, max: 1100, weight: "nice" }, pets: { values: ["cat", "dog"], weight: "must" },
  leaseMonths: { values: [6, 12], weight: "want" }, amenities: [{ key: "parking", weight: "must" }, { key: "laundry", weight: "want" }, { key: "furnished", weight: "nice" }],
};
const standingUnknowns = ["Move-in availability and current pricing need confirmation", "Additional preferences need confirmation"];
const baseListing = { _creationTime: 123, searchId: "fixture-search", url: "http://127.0.0.1:5173/listing-fixture", summary: "Published apartment details.",
  rent: 1500, bedrooms: 1, contactEmail: "leasing@example.com", checkedAt: 123 };
const resultsFixture = { preferences: savedPreferences, status: "complete", omittedMustMisses: 3, listings: [
  { ...baseListing, _id: "confirmed", title: "All preferences confirmed", score: 30, mustMisses: 0, unknowns: standingUnknowns,
    matches: ["Ann Arbor", "Within your rent range", "1 bedrooms", "2.5 bathrooms", "900 sq ft", "Floor 5", "Cats allowed", "Dogs allowed", "12 month lease", "Parking", "In-unit laundry", "Furnished"] },
  { ...baseListing, _id: "unknown", title: "Details still unknown", score: 15, mustMisses: 0,
    matches: ["Ann Arbor", "Within your rent range", "1 bedrooms", "Cats allowed", "Dogs allowed"], unknowns: [...standingUnknowns, "Floor not confirmed"] },
  { ...baseListing, _id: "conflicted", title: "Known must-have conflicts", bedrooms: 3, score: -3, mustMisses: 2,
    matches: ["Ann Arbor", "Within your rent range", "Cats allowed", "Dogs allowed"],
    unknowns: [...standingUnknowns, "1 or 2 bedrooms: conflicts with must-have", "Parking: conflicts with must-have", "In-unit laundry: conflicts with preference", "Floor not confirmed", "Bathrooms not confirmed"] },
] };

async function fixture(page: Page, view: "preferences" | "results", props: Record<string, unknown> = {}) {
  page.on("pageerror", error => console.log("Fixture browser error:", error.message));
  await page.route("**/src/main.tsx*", route => route.fulfill({ contentType: "application/javascript", body: `
    import React from "/node_modules/.vite/deps/react.js";
    import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js";
    import { ConvexProvider } from "/node_modules/.vite/deps/convex_react.js";
    import "/src/styles.css";
    const props = ${JSON.stringify(props)};
    const submissions = [];
    const client = {
      mutation: async (name, args) => {
        submissions.push(args);
        document.querySelector('[data-testid="submissions"]').textContent = JSON.stringify(submissions);
        return "fixture-search";
      },
      watchQuery: () => ({ localQueryResult: () => props.results, onUpdate: () => () => {}, journal: () => undefined }),
    };
    const Component = ${view === "preferences" ? '(await import("/src/Preferences.tsx")).default' : '(await import("/src/Dashboard.tsx")).Results'};
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ConvexProvider, { client },
      React.createElement("main", null, React.createElement(Component, { ...props, searchId: "fixture-search", onClose() {}, onSearch() {}, onSent() {} }),
      React.createElement("output", { "data-testid": "submissions", hidden: true }, "[]"))));
  ` }));
  await page.goto("/");
}

test("offline: two bedroom selections submit one search", async ({ page }) => {
  await fixture(page, "preferences");
  const bedrooms = page.getByRole("group", { name: "Bedrooms", exact: true });
  await expect(bedrooms.getByRole("button", { name: "1 bedroom", exact: true })).toHaveAttribute("aria-pressed", "true");
  await bedrooms.getByRole("button", { name: "2 bedrooms", exact: true }).click();
  await page.getByLabel("Move-in date").fill("2026-11-01");
  await page.getByRole("button", { name: "Find my apartments" }).click();
  await expect(page.getByTestId("submissions")).not.toHaveText("[]");
  const submissions = JSON.parse(await page.getByTestId("submissions").textContent() ?? "[]");
  expect(submissions).toHaveLength(1);
  expect(submissions[0].preferences.bedrooms).toEqual({ values: [1, 2], weight: "must" });
});

test("offline: weight controls require a selected value", async ({ page }) => {
  await fixture(page, "preferences");
  const bathrooms = page.getByRole("group", { name: "Bathrooms", exact: true });
  const must = bathrooms.getByRole("radio", { name: "Must have", exact: true });
  await expect(must).toBeDisabled();
  await bathrooms.getByRole("button", { name: "1 bathroom", exact: true }).click();
  await expect(must).toBeEnabled();
  await must.check();
  await bathrooms.getByRole("button", { name: "1 bathroom", exact: true }).click();
  await expect(must).toBeDisabled();
  await expect(page.getByRole("radiogroup", { name: "Parking importance" })).toHaveCount(0);
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Parking importance" }).getByRole("radio", { name: "Nice to have" })).toBeChecked();
});

test("offline: saved criteria seed every control and survive submission", async ({ page }) => {
  await fixture(page, "preferences", { initial: savedPreferences });
  await expect(page.getByRole("button", { name: "2 bedrooms", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Dog", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Minimum square feet")).toHaveValue("700");
  await expect(page.getByLabel("Maximum square feet")).toHaveValue("1100");
  await expect(page.getByRole("radiogroup", { name: "In-unit laundry importance" }).getByRole("radio", { name: "Really want" })).toBeChecked();
  await page.getByRole("button", { name: "Find my apartments" }).click();
  await expect(page.getByTestId("submissions")).toHaveText(JSON.stringify([{ preferences: savedPreferences }]));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/preferences-mobile.png" });
});

test("offline: result groups count criteria and keep greyed cards keyboard-accessible", async ({ page }) => {
  await fixture(page, "results", { results: resultsFixture });
  await expect(page.getByRole("heading", { name: "Has everything you asked for" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Close — a few details to confirm" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Missing something you marked must-have" })).toBeVisible();
  await expect(page.getByText("2 matches · 4 missing a must-have", { exact: true })).toBeVisible();
  await expect(page.getByText("9 of 9 preferences", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 9 preferences", { exact: true })).toBeVisible();
  await expect(page.getByText("3 additional listings missing a must-have are not shown.", { exact: true })).toBeVisible();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Known must-have conflicts" }) });
  await expect(card).toHaveClass(/listing-card--miss/);
  const minimumContrast = await card.evaluate(element => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const canvas = rgb(getComputedStyle(document.documentElement).backgroundColor);
    const cardStyle = getComputedStyle(element); const opacity = Number(cardStyle.opacity);
    const composite = (color: number[]) => color.map((channel, i) => channel * opacity + canvas[i] * (1 - opacity));
    const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
      .reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
    return Math.min(...Array.from(element.querySelectorAll("h3, p, .preference-count, .listing-top, summary, a, .match-tags span, button")).map(node => {
      const style = getComputedStyle(node);
      const background = style.backgroundColor === "rgba(0, 0, 0, 0)" ? cardStyle.backgroundColor : style.backgroundColor;
      const foreground = luminance(composite(rgb(style.color))); const behind = luminance(composite(rgb(background)));
      return (Math.max(foreground, behind) + .05) / (Math.min(foreground, behind) + .05);
    }));
  });
  expect(minimumContrast).toBeGreaterThanOrEqual(4.5);
  await expect(card.getByText("Misses: 1 or 2 bedrooms, parking", { exact: true })).toBeVisible();
  const link = card.getByRole("link", { name: "View listing" });
  for (let i = 0; i < 20 && !await link.evaluate(element => element === document.activeElement); i++) await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  const opened = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const popup = await opened;
  await expect(popup).toHaveURL(/listing-fixture/);
  await popup.close();
  await expect(card.getByRole("button", { name: "Follow up" })).toBeEnabled();
  await card.getByRole("button", { name: "Follow up" }).click();
  await expect(page.getByRole("dialog", { name: "Start the conversation" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({ path: "test-results/grouped-results.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("offline: empty groups have no headings and an empty search explains the result", async ({ page }) => {
  await fixture(page, "results", { results: { ...resultsFixture, listings: [], omittedMustMisses: 0 } });
  await expect(page.getByRole("heading", { name: "No suitable listings in this batch." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Has everything you asked for" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Close — a few details to confirm" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Missing something you marked must-have" })).toHaveCount(0);
});

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
  await expect(page.getByRole("heading", { name: "What should we call you?" })).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Your name", { exact: true }).fill("  Alex Taylor  ");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Move-in date").fill("2026-11-01");
  await page.getByLabel("Maximum monthly rent").fill("2500");
  await page.getByRole("group", { name: "Bedrooms", exact: true }).getByRole("button", { name: "2 bedrooms", exact: true }).click();
  await page.getByRole("button", { name: "Find my apartments" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Looking around Ann Arbor…")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Looking around Ann Arbor…")).not.toBeVisible({ timeout: 180000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  const listingCount = await page.locator(".listing-card").count();
  console.log(`Live search returned ${listingCount} potential matches.`);
  console.log(`Live flexible search ID: ${await page.getByLabel("Your saved searches").inputValue()}`);
  await expect(page.getByLabel("Your saved searches").locator("option")).toHaveCount(1);
  if (!listingCount) await expect(page.getByText("No suitable listings in this batch.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "New apartment search" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Hello, Alex Taylor", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New apartment search" }).click();
  await expect(page.getByLabel("Maximum monthly rent")).toHaveValue("2500");
  await expect(page.getByLabel("Move-in date")).toHaveValue("2026-11-01");
  await expect(page.getByRole("button", { name: "1 bedroom", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "2 bedrooms", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "New apartment search" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Hello, Alex Taylor", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What should we call you?" })).not.toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
