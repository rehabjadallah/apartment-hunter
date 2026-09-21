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
  rent: 1500, bedrooms: 1, complexName: "Maple Grove Apartments", contactEmail: "leasing@example.com", checkedAt: 123 };
const resultsFixture = { preferences: savedPreferences, status: "complete", listings: [
  { ...baseListing, _id: "confirmed", title: "All preferences confirmed", score: 30, mustMisses: 0, unknowns: standingUnknowns,
    matches: ["Ann Arbor", "Within your rent range", "1 bedrooms", "2.5 bathrooms", "900 sq ft", "Floor 5", "Cats allowed", "Dogs allowed", "12 month lease", "Parking", "In-unit laundry", "Furnished"] },
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
      // Offline runs have no OpenAI access, so drafting fails and the fallback template is asserted below.
      action: async () => { throw new Error("offline"); },
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
  await bedrooms.getByRole("button", { name: "1 bedroom", exact: true }).click();
  await bedrooms.getByRole("button", { name: "2 bedrooms", exact: true }).click();
  await page.getByLabel("Move-in date").fill("2026-11-01");
  await page.getByRole("button", { name: "Find my apartments" }).click();
  await expect(page.getByTestId("submissions")).not.toHaveText("[]");
  const submissions = JSON.parse(await page.getByTestId("submissions").textContent() ?? "[]");
  expect(submissions).toHaveLength(1);
  expect(submissions[0].preferences.bedrooms).toEqual({ values: [1, 2], weight: "must" });
});

test("offline: selections are required and cleared filters have no preference", async ({ page }) => {
  await fixture(page, "preferences");
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  const bathrooms = page.getByRole("group", { name: "Bathrooms", exact: true });
  await bathrooms.getByRole("button", { name: "1 bathroom", exact: true }).click();
  await bathrooms.getByRole("button", { name: "1 bathroom", exact: true }).click();
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await page.getByRole("button", { name: "In-unit laundry", exact: true }).click();
  await page.getByRole("button", { name: "Dog", exact: true }).click();
  await page.getByLabel("Minimum square feet").fill("700");
  await page.getByLabel("Minimum square feet").fill("");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.getByLabel("Move-in date").fill("2026-11-01");
  await page.getByRole("button", { name: "Find my apartments" }).click();
  await expect(page.getByTestId("submissions")).toHaveText(JSON.stringify([{ preferences: {
    city: "Ann Arbor, Michigan", minRent: 800, maxRent: 2000, moveIn: "2026-11-01", notes: "",
    bedrooms: { values: [], weight: "must" }, bathrooms: { values: [], weight: "must" }, floors: { values: [], weight: "must" },
    leaseMonths: { values: [], weight: "must" }, sqft: { weight: "must" }, pets: { values: ["dog"], weight: "must" },
    amenities: [{ key: "laundry", weight: "must" }],
  } }]));
});

test("offline: saved selections survive submission as required filters", async ({ page }) => {
  await fixture(page, "preferences", { initial: savedPreferences });
  await expect(page.getByRole("button", { name: "2 bedrooms", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Dog", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Minimum square feet")).toHaveValue("700");
  await expect(page.getByLabel("Maximum square feet")).toHaveValue("1100");
  await expect(page.getByRole("button", { name: "In-unit laundry", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.getByRole("button", { name: "Find my apartments" }).click();
  await expect(page.getByTestId("submissions")).toHaveText(JSON.stringify([{ preferences: {
    ...savedPreferences, bathrooms: { values: [2], weight: "must" }, floors: { values: [3], weight: "must" },
    sqft: { min: 700, max: 1100, weight: "must" }, leaseMonths: { values: [6, 12], weight: "must" },
    amenities: [{ key: "parking", weight: "must" }, { key: "laundry", weight: "must" }, { key: "furnished", weight: "must" }],
  } }]));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/preferences-mobile.png" });
});

test("offline: matching results keep listing links and follow-up keyboard-accessible", async ({ page }) => {
  await fixture(page, "results", { results: resultsFixture });
  await expect(page.getByRole("heading", { name: "Matching apartments", exact: true })).toBeVisible();
  await expect(page.getByText("1 matching apartment", { exact: true })).toBeVisible();
  await expect(page.getByText(/must-have|Close —|Misses:/)).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(1);
  const card = page.getByRole("article");
  await expect(card).toHaveClass("listing-card");
  await expect(card.locator("h3 + .complex-name")).toHaveText("Maple Grove Apartments");
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
  await page.screenshot({ path: "test-results/matching-results.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("offline: an empty search explains how to change the filters", async ({ page }) => {
  await fixture(page, "results", { results: { ...resultsFixture, listings: [] } });
  await expect(page.getByRole("heading", { name: "No listings match your selected filters." })).toBeVisible();
  await expect(page.getByText("Try removing a filter or widening your budget.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matching apartments", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("offline: inquiry drafts include every selected amenity regardless of old priority", async ({ page }) => {
  await fixture(page, "results", { results: resultsFixture });
  await page.getByRole("button", { name: "Follow up" }).click();
  const draft = await page.getByLabel("Your message").inputValue();
  expect(draft).toContain("a 1 or 2 bedroom apartment");
  expect(draft).toContain("I have a cat and a dog.");
  expect(draft).toContain("I'm looking for parking, in-unit laundry, and furnished.");
  expect(draft).not.toMatch(/gym|elevator|pool|conflicts with|did not confirm/);
  expect(draft).toContain("Could you confirm availability, total monthly costs, lease terms, and how to schedule a tour?");
  await expect(page.getByLabel("Subject")).toHaveValue("Apartment inquiry: All preferences confirmed");
  await expect(page.getByLabel("Your message")).toHaveAttribute("maxlength", "5000");
  await expect(page.getByTestId("submissions")).toHaveText("[]");
});

for (const { values, phrase } of [
  { values: [0], phrase: "a studio in Ann Arbor" },
  { values: [0, 2], phrase: "a studio or a 2 bedroom apartment in Ann Arbor" },
  { values: [], phrase: "an apartment in Ann Arbor" },
]) {
  test(`offline: inquiry drafts describe ${phrase}`, async ({ page }) => {
    await fixture(page, "results", { results: { ...resultsFixture, preferences: { ...savedPreferences, bedrooms: { values, weight: "must" } },
      listings: [resultsFixture.listings[0]] } });
    await page.getByRole("button", { name: "Follow up" }).click();
    await expect(page.getByLabel("Your message")).toHaveValue(new RegExp(phrase));
  });
}

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
  await page.getByRole("group", { name: "Bedrooms", exact: true }).getByRole("button", { name: "1 bedroom", exact: true }).click();
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
  if (!listingCount) await expect(page.getByText("No listings match your selected filters.")).toBeVisible();
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
