# Firecrawl discovery — change spec

Branch: `firecrawl-discovery`

## 1. Objective

One search must insert 15 or more listings. One search now inserts 1 or 2 listings.

Two causes exist. Cloudflare blocks most scrapes. The code then drops most of
the pages that do return content.

## 2. Terms

Use these terms with one meaning each.

- **page** — one URL that Firecrawl scrapes.
- **unit** — one floor plan offered on a page. One page can offer many units.
- **listing** — one row in the `listings` table. One unit becomes one listing.
- **drop** — discard a candidate before the database insert.

## 3. Scope

Change these files only:

- `convex/discovery.ts`
- `tests/discovery.test.ts`

Do not change `convex/schema.ts`. A second branch owns that file. A change there
causes a merge conflict.

Do not change `convex/inquiries.ts`. A second branch owns that file.

Do not add the `sources` table. Do not add an add-listing-by-URL path. Both are
out of scope for this branch.

## 4. Tasks

Complete the tasks in order. Each task depends on the task before it.

### Task 1 — Log the reason each page fails

The action now discards every scrape error. The current code is at
`convex/discovery.ts:71`:

```ts
} catch { /* One inaccessible listing must not discard other results. */ }
```

Required change:

1. Log the URL and the error in the `catch` block.
2. Read `page.metadata.statusCode` after each successful scrape. Log the URL and
   the status code.
3. Count the pages at four stages. The stages are: URLs returned by search, URLs
   after deduplication, pages that returned content, and listings inserted.
4. Log the four counts once, before the action calls `internal.searches.finish`.

Keep the current behavior. One failed page must not stop the other pages.

Reason: the current code cannot show whether a page was blocked, timed out, or
was dropped by a filter. The counts identify which stage loses the most pages.

### Task 2 — Enable the stealth proxy

Cloudflare returns HTTP 403 for the target sites. The `www.villasatnorthstar.com`
response headers confirm this:

```
HTTP/2 403
cf-mitigated: challenge
server: cloudflare
```

The current scrape options are at `convex/discovery.ts:43`:

```ts
onlyMainContent: true, timeout: 45000, maxAge: 3600000,
```

Required change:

```ts
onlyMainContent: false, timeout: 45000, maxAge: 0,
proxy: "auto", waitFor: 3000,
```

Notes:

- `proxy` accepts `"basic"`, `"stealth"`, `"enhanced"`, and `"auto"`. The type is
  at `node_modules/@firecrawl/firecrawl-convex/dist/client/index.d.ts:44`.
- Use `"auto"`. `"auto"` uses the cheap path first. `"stealth"` uses the
  expensive path on every page.
- `maxAge: 0` disables the Firecrawl cache. A cached result hides the effect of
  the proxy change during testing.
- Restore `maxAge: 3600000` after the acceptance criteria pass.

Task 3 explains the `onlyMainContent` change.

### Task 3 — Read the full page

`onlyMainContent: true` removes the page header and the page footer. The city
name and the leasing email address are usually in the footer.

Task 2 sets `onlyMainContent: false`. No further code change is needed.

Reason: the extraction returns `city: null` and `contactEmail: null` for pages
that state both values in the footer. A listing without a contact email cannot
receive an inquiry.

### Task 4 — Extract every unit on a page

The current extraction prompt at `convex/discovery.ts:47` requests one unit per
page. A property page usually offers 6 to 10 units. The code keeps one and
discards the rest.

Required change:

1. Move the unit values into an array. Keep the property values at the top level.

```ts
const unit = {
  type: "object",
  properties: {
    title: nullable("string"),
    rent: nullable("number"),
    bedrooms: nullable("number"),
  },
};

const schema = {
  type: "object",
  properties: {
    isListing: { type: "boolean" },
    city: nullable("string"),
    summary: nullable("string"),
    contactEmail: nullable("string"),
    cats: nullable("boolean"),
    dogs: nullable("boolean"),
    parking: nullable("boolean"),
    laundry: nullable("boolean"),
    units: { type: "array", items: unit },
  },
};
```

2. Rewrite the prompt. Request every floor plan on the page. Keep the current
   instruction to return `null` instead of a guess. Keep the current instruction
   that `contactEmail` must be the leasing contact published on the page.
3. Insert one listing per unit. Apply the rent test and the bedrooms test per
   unit. Apply the city test, the pets test, the parking test, and the laundry
   test once per page.
4. Build `matches` and `unknowns` per unit, as the current code does.

Constraint: the `listings` table has no column for square footage and no column
for the available date. Do not add either column. Task 3 of the AgentMail branch
adds the `fields` table for those values.

Reason: this task multiplies the listing count without increasing the scrape
count. It is the largest single gain available.

### Task 5 — Drop a candidate only on a known conflict

The current test at `convex/discovery.ts:47` drops a page when `city` is `null`:

```ts
if (!d || d.isListing !== true || typeof d.city !== "string" || !/^ann arbor(?:,?\s+(?:mi|michigan))?$/i.test(d.city.trim())) return;
```

Required change:

1. Keep the page when `city` is `null`. Add `"City not confirmed"` to `unknowns`.
2. Drop the page when `city` states a different city. Keep this behavior.
3. Accept `"Ann Arbor Charter Township"` as Ann Arbor.

Follow the pattern the rent test and the bedrooms test already use. Those tests
drop a candidate only when the extracted value conflicts with the brief.

Reason: an unknown value is the product's core case. An unknown value generates
an email to the leasing office. A dropped page generates nothing.

### Task 6 — Widen the search

The current values are at `convex/discovery.ts:26` and `convex/discovery.ts:37`:

```ts
{ limit: 8, ... }
}).slice(0, 5);
```

Required change:

```ts
{ limit: 20, ... }
}).slice(0, 15);
```

Complete tasks 1 to 5 first. More pages through a failing pipeline waste
Firecrawl credits.

## 5. Tests

Update `tests/discovery.test.ts`. The file mocks the Firecrawl client. No test
calls the network.

1. Update the `matching` fixture. The fixture must use the `units` array from
   Task 4.
2. Keep the test named `"excludes known conflicts and listings outside Ann
   Arbor"`. The Ypsilanti case must still drop.
3. Add a test: a page with `city: null` inserts a listing. The listing's
   `unknowns` array contains `"City not confirmed"`.
4. Add a test: a page with 5 units inserts 5 listings.
5. Add a test: a page with 5 units inserts 2 listings when 3 units state a rent
   above `maxRent`.
6. Keep the test named `"one failed scrape preserves the other results"`.

## 6. Acceptance criteria

All six criteria must pass.

1. `npm run typecheck` reports no error.
2. `npm test` passes. The suite contains the three new tests from section 5.
3. One live search against a real brief inserts 15 or more listings.
4. The Convex logs report the four stage counts from Task 1.
5. The Convex logs report an HTTP status code for every page.
6. Five or more of the inserted listings have a `contactEmail` value.

Report the four stage counts from the live search. Report the number of pages
that returned HTTP 403.

## 7. Verification commands

```sh
npm run typecheck
npm test
npx convex logs
```

Run the live search through the running app. Do not run `npm run test:e2e`. That
test creates an account and spends Firecrawl credits.

## 8. Checkpoints

Stop after every task. Do not start the next task until the user replies.

At each stop, do these four steps in order.

1. Run `npm run typecheck` and `npm test`. Report the result of each.
2. Print the list of changed files.
3. Print 2 or 3 lines that state what changed and why.
4. Print the exact git commands. Write the commit message. Do not run the
   commands.

Use this format:

```
=== CHECKPOINT — task 3 of 6 ===

typecheck: pass
tests:     pass (11 passed)

Changed:
  convex/discovery.ts

What changed:
  - Set onlyMainContent to false, so the scrape reads the page footer.
  - The footer holds the city name and the leasing email address.

Check this:
  Run one search. Confirm that contactEmail is now set on some listings.

Commit:
  git add convex/discovery.ts
  git commit -m "task 3: read full page so footer contact data is captured"

Waiting for your review. Reply "continue" to start task 4.
```

If a test fails, stop. Report the failure. Do not start the next task.

## 9. Do not do

- Do not run `git commit`. Do not run `git push`. Print the command instead.
- Do not change `convex/schema.ts`.
- Do not change any file under `src/`.
- Do not send email.
- Do not remove the current instruction that tells the model to return `null`
  instead of a guess. A wrong value is worse than an unknown value.
- Do not remove the check that the extracted email address appears in the page
  markdown. That check blocks invented email addresses.
