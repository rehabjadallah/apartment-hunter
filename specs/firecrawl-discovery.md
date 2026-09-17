# Firecrawl discovery — change spec

Branch: `firecrawl-discovery`

## 1. Objective

One search must insert 15 or more listings. One search now inserts 1 listing.

The cause is measured, not assumed. Section 4 records two live runs. The search
step returns sites that are not apartment sources. The scrape step then spends
requests on them, and the filter step drops what returns.

## 2. Terms

Use these terms with one meaning each.

- **page** — one URL that Firecrawl scrapes.
- **unit** — one floor plan offered on a page. One page can offer many units.
- **listing** — one row in the `listings` table. One unit becomes one listing.
- **drop** — discard a candidate before the database insert.
- **property page** — a page published by one apartment community or its leasing
  agent. It offers floor plans and a leasing contact.
- **directory page** — a page that lists many properties. It offers no floor plan
  and no leasing contact.
- **non-source** — a domain that is not an apartment source at all. A social
  network, a review site, and a vacation rental site are non-sources.

## 3. Scope

Change these files only:

- `convex/discovery.ts`
- `tests/discovery.test.ts`

Do not change `convex/schema.ts`. The `listings` table has no column for square
footage and no column for the available date. Do not add either column, and do
not add a table. Drop those values.

Do not add the `sources` table. Do not add an add-listing-by-URL path. Both are
out of scope for this branch.

This branch is current with `main`. `main` carries the AgentMail component patch
in `patches/` and an `.npmrc` that sets `allow-remote=root`. Run `npm ci` before
you start and confirm the output contains `@agentmail/convex@0.1.0 ✔`. Without
the patch, `npx convex dev` fails before any of this work can be tested.

## 4. Measurements

Two live runs, after Task 1 and Task 2. Read these before planning any change.

### Run A — 9/16 16:45, after Task 1

```
urlsReturned: 8   urlsAfterDeduplication: 8   pagesWithContent: 4   listingsInserted: 1
```

URLs scraped: `facebook.com` (403 policy refusal), `verveannarbor.com` (200),
`mckinley.com/.../park-place/` (200), `homes.com` (200), `trulia.com` (200).

### Run B — 9/16 21:48, after Task 2

```
urlsReturned: 8   urlsAfterDeduplication: 8   pagesWithContent: 3   listingsInserted: 1
```

URLs scraped: `facebook.com` (403 policy refusal), `yelp.com` (403 policy
refusal), `rentcafe.com` (200), `homes.com` (200), `hometogo.com` (200).

The single listing inserted by Run B reads `Child-friendly vacation home with
BBQ, patio & yard. Suitable for remote work.` It came from `hometogo.com`. It is
a vacation rental, not an apartment.

### What the runs establish

1. **The search returns non-sources.** Across 10 scraped URLs, Run A had two
   property pages and Run B had none. The rest were a social network, a review
   site, a vacation rental site, and directory pages.
2. **Cloudflare is not the blocker.** Neither run produced a single
   `Cloudflare challenge`. Every 403 was a Firecrawl policy refusal. The premise
   of the original Task 2 was wrong.
3. **The refusal list is not stable.** `rentcafe.com` returned 403 at 13:59 and
   200 in Run B. Do not hard-code `rentcafe.com` as refused.
4. **A counted stage is missing.** `convex/discovery.ts:67` reads
   `uniqueUrls.slice(0, 5)`. Only 5 of the 8 deduplicated URLs are ever scraped.
   Task 1's four counts hide this. The true funnel for Run A is
   `8 returned → 8 deduplicated → 5 selected → 4 returned content → 1 inserted`.

## 5. Tasks

Complete the tasks in order. Each task depends on the task before it.

### Task 1 — Log the reason each page fails — COMPLETE

Already applied and committed. Do not redo it.

It logs a status code per page, logs the URL and error on failure, classifies
each 403 as `Cloudflare challenge`, `Firecrawl policy refusal`, or
`Unclassified HTTP 403`, and logs four stage counts before the search finishes.

Task 3 adds the missing fifth count.

### Task 2 — Proxy and full-page scrape — APPLIED, KEEP

Already applied. The scrape options at `convex/discovery.ts:71` now read:

```ts
onlyMainContent: false, timeout: 45000, maxAge: 0,
proxy: "auto", waitFor: 3000,
```

Keep all four settings, for these reasons:

- `onlyMainContent: false` is required. The page footer holds the city name and
  the leasing email address. This is the change that makes `contactEmail`
  reachable at all.
- `proxy: "auto"` did not measurably help, but it is the cheap path first and it
  may explain why `rentcafe.com` succeeded in Run B. It costs little. Keep it.
- `maxAge: 0` stays until Task 7 restores the cache.

Do not spend another live run testing the proxy. Section 4 records that no
Cloudflare challenge occurred in either run.

### Task 3 — Stop searching non-sources

This is the highest-value task. Every task after it operates on whatever this
task returns.

The search call is at `convex/discovery.ts:51`:

```ts
const response = await firecrawl.search(ctx,
  `Ann Arbor Michigan ${p.bedrooms === 0 ? "studio" : `${p.bedrooms} bedroom`} apartments floor plans rent ${p.pets === "none" ? "" : `${p.pets} friendly`}`,
  { limit: 8, location: "Ann Arbor, Michigan, United States", sources: ["web"],
    excludeDomains: ["zillow.com", "apartments.com", "realtor.com", "redfin.com", "reddit.com"] });
```

Required change:

1. Extend `excludeDomains`. Add the non-sources and directory domains observed in
   section 4, and the obvious members of the same categories:

   ```
   facebook.com, yelp.com, hometogo.com, tripadvisor.com, airbnb.com, vrbo.com,
   pinterest.com, homes.com, trulia.com
   ```

   Keep the five domains already listed. Do not add `rentcafe.com` — section 4
   point 3 explains why.

2. Rewrite the query to bias toward property pages. The current query asks for
   `apartments floor plans rent`, which matches directories. State the intent of
   a property page instead: a named apartment community in Ann Arbor with a floor
   plan page and a leasing contact. Keep the bedroom count and the pet term.

3. Add a fifth count, `urlsSelectedForScrape`, recording the length of the array
   after `uniqueUrls.slice(...)` at `convex/discovery.ts:67`. Log it with the
   other counts, between `urlsAfterDeduplication` and `pagesWithContent`.

4. Log the selected URL list once, before the scrape loop, so a run can be read
   without reconstructing it from per-page lines.

Acceptance for this task: in one live run, at least 3 of the selected URLs are
property pages as defined in section 2. Report the list.

Reason: Run B scraped five URLs and not one was an apartment source. No
downstream change can recover from that.

### Task 4 — Extract every unit on a page

The extraction prompt at `convex/discovery.ts:72` requests one unit per page. A
property page usually offers 6 to 10 units. The code keeps one and discards the
rest.

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
   that `contactEmail` must be the leasing contact published on the page. Keep
   the current instruction that `isListing` is false for directory pages.
3. Insert one listing per unit. Apply the rent test and the bedrooms test per
   unit. Apply the city test, the pets test, the parking test, and the laundry
   test once per page.
4. Build `matches` and `unknowns` per unit, as the current code does.

Constraint: the `listings` table has no column for square footage and no column
for the available date. Do not add either column, and do not add a table. Drop
those values.

Reason: this task multiplies the listing count without increasing the scrape
count. It is the largest gain available once Task 3 supplies property pages.

### Task 5 — Drop a candidate only on a known conflict

The current test at `convex/discovery.ts:80` drops a page when `city` is `null`:

```ts
if (!d || d.isListing !== true || typeof d.city !== "string" || !/^ann arbor(?:,?\s+(?:mi|michigan))?$/i.test(d.city.trim())) return;
```

Required change:

1. Keep the page when `city` is `null`. Add `"City not confirmed"` to `unknowns`.
2. Drop the page when `city` states a different city. Keep this behavior.
3. Accept `"Ann Arbor Charter Township"` as Ann Arbor.
4. Keep dropping a page when `isListing` is false. Task 3 reduces how often that
   happens; it does not make directory pages acceptable.

Follow the pattern the rent test and the bedrooms test already use. Those tests
drop a candidate only when the extracted value conflicts with the brief.

Reason: an unknown value is the product's core case. An unknown value generates
an email to the leasing office. A dropped page generates nothing.

### Task 6 — Widen the search

The current values are at `convex/discovery.ts:53` and `convex/discovery.ts:67`:

```ts
{ limit: 8, ... }
}).slice(0, 5);
```

Required change:

```ts
{ limit: 20, ... }
}).slice(0, 15);
```

Complete tasks 3 to 5 first, and confirm Task 3's acceptance holds. More pages
through a search that returns non-sources multiplies the waste rather than the
listings.

### Task 7 — Restore the Firecrawl cache

Task 2 set `maxAge: 0` so a cached result could not hide the effect of a change.
That setting makes every search pay for a fresh scrape.

Required change:

Restore `maxAge: 3600000` in the scrape options at `convex/discovery.ts:71`.

Run one live search after the change. Confirm the listing count from acceptance
criterion 4 still holds.

Do this task last, after the other acceptance criteria pass.

## 6. Tests

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
6. Add a test: a page with `isListing: false` inserts nothing.
7. Add a test: the search call passes every denied domain from Task 3 in
   `excludeDomains`.
8. Keep the test named `"one failed scrape preserves the other results"`.

## 7. Acceptance criteria

Criterion 4 sets a target that the counts must justify. Complete Task 3 first and
report the selected URL list and the five counts. If the number of property pages
cannot support 15 listings, say so and propose the number the pipeline can reach.
Do not raise the scrape count to compensate.

All criteria must pass.

1. `npm run typecheck` reports no error.
2. `npm test` passes. The suite contains the four new tests from section 6.
3. In one live run, at least 3 selected URLs are property pages.
4. One live search inserts 15 or more listings, or the number agreed after the
   Task 3 report.
5. The Convex logs report five stage counts, including `urlsSelectedForScrape`.
6. The Convex logs report an HTTP status code for every page, and a reason for
   every 403.
7. Five or more of the inserted listings have a `contactEmail` value.
8. No inserted listing is a vacation rental.
9. `maxAge` is restored to 3600000 by Task 7.

Report the five stage counts and the selected URL list from the final run.

## 8. Verification commands

```sh
npm run typecheck
npm test
npx convex logs
npx convex data listings --limit 10
```

Run the live search through the running app. Start `npx convex logs` before
submitting the search. Do not run `npm run test:e2e`. That test creates an
account and spends Firecrawl credits.

Searches are rate limited to one per minute per account.

## 9. Checkpoints

Stop after every task. Do not start the next task until the user replies.

At each stop, do these four steps in order.

1. Run `npm run typecheck` and `npm test`. Report the result of each.
2. Print the list of changed files.
3. Print 2 or 3 lines that state what changed and why.
4. Print the exact git commands. Write the commit message. Do not run the
   commands.

Use this format:

```
=== CHECKPOINT — task 3 of 7 ===

typecheck: pass
tests:     pass (12 passed)

Changed:
  convex/discovery.ts
  tests/discovery.test.ts

What changed:
  - Extended excludeDomains with the non-sources observed in section 4.
  - Rewrote the query to ask for named apartment communities, not directories.
  - Added the urlsSelectedForScrape count that the slice was hiding.

Check this:
  Run one search. Report the selected URL list and the five counts.

Commit:
  git add convex/discovery.ts tests/discovery.test.ts
  git commit -m "task 3: stop searching non-apartment sources"

Waiting for your review. Reply "continue" to start task 4.
```

If a test fails, stop. Report the failure. Do not start the next task.

## 10. Do not do

- Do not run `git commit`. Do not run `git push`. Print the command instead.
- Do not change `convex/schema.ts`.
- Do not change any file under `src/`.
- Do not change any file under `patches/`.
- Do not send email.
- Do not add `rentcafe.com` to any denied list.
- Do not spend a live run re-testing the proxy setting.
- Do not remove the current instruction that tells the model to return `null`
  instead of a guess. A wrong value is worse than an unknown value.
- Do not remove the check that the extracted email address appears in the page
  markdown. That check blocks invented email addresses.
