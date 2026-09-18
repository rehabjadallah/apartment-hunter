import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByText("Hello, Alex Taylor", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New apartment search" }).click();
  await expect(page.getByLabel("Maximum monthly rent")).toHaveValue("2500");
  await expect(page.getByLabel("Move-in date")).toHaveValue("2026-11-01");
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
