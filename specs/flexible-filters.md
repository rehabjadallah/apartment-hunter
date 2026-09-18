# Flexible filters — change spec

Branch: `flexible-filters`

## September 18 update — strict selected filters

This update supersedes the ranking, priority controls, and fallback groups below.
Keep the multi-select toggles, including the amenity grid, with no weight controls.
Show a listing only when every selected filter is confirmed, including the rent
range. A conflicting or unconfirmed selected filter excludes the listing from
results. Multiple values within a criterion remain alternatives; all selected
animals and amenities must be confirmed. Empty criteria impose no restriction.

New forms start with no optional selections. A blank bedroom selection also omits
the bedroom term from discovery. Apply filtering in the results query so saved
searches follow the same rules without running another paid search. Keep stored
candidates and legacy scores for existing data compatibility; they do not affect
inclusion or ordering. Return matching listings sorted by rent, with no fallback
group or cap on matches. Show one list and an actionable empty state. Inquiry
drafts include every selected amenity, regardless of its old priority.

Move-in availability and free-text notes remain questions to confirm, as the
extractor has no structured facts for them. The form states this limitation.

## 1. Objective

A search must return a ranked list, not a filtered one.

Today every preference is a gate. `convex/discovery.ts:110` drops a whole page
when one property fact conflicts. `convex/discovery.ts:117` and
`convex/discovery.ts:118` drop a unit when its rent or bedroom count conflicts.
A user who is open to a 1 bedroom or a 2 bedroom must run two searches, and a
user who adds a preference sees fewer results for having said more.

After this change:

1. A user selects several values for one filter. One search covers all of them.
2. A user marks each filter must, want, or nice. The mark sets its weight.
3. Every candidate that survives the structural tests is stored. A preference is
   never a reason to drop.
4. Results sort by score. Listings that satisfy more of the brief appear first.
5. Listings that miss a must-have still appear, greyed out, at the bottom.

## 2. Terms

Use these terms with one meaning each. The terms in `specs/firecrawl-discovery.md`
section 2 still apply — page, unit, listing, drop, property page, directory page,
non-source.

- **criterion** — one filter the user can set. `bedrooms` is a criterion.
  `amenities` holds one criterion per amenity.
- **weight** — how much a criterion counts: `must`, `want`, or `nice`.
- **selected values** — the values a user picked for one criterion. An empty
  array means the user did not use that criterion.
- **confirmed** — the page stated the fact and it satisfies the criterion.
- **unconfirmed** — the page did not state the fact. The extractor returned null.
- **conflicted** — the page stated the fact and it does not satisfy the criterion.
- **structural test** — a test that is not a preference: `units` is empty, or
  `city` names a different city. These still drop.
- **must miss** — one criterion weighted `must` that the listing conflicts with.
- **score** — the sum of a listing's criterion points. Section 5, Task 4 defines it.

## 3. Scope

Change these files:

- `convex/schema.ts`
- `convex/searches.ts`
- `convex/discovery.ts`
- `convex/migrations.ts` (new)
- `src/Preferences.tsx`
- `src/Dashboard.tsx`
- `src/styles.css`
- `tests/discovery.test.ts`
- `tests/browser/app.spec.ts`

Out of scope for this branch. Do not start any of these.

- **Neighborhood and distance filters.** They need geocoding and a travel-time
  source. Neither exists in this codebase.
- **Utilities included.** Property pages state this too rarely to rank on.
- **Saved filter presets.** One search shape per user is enough for now.
- **A points slider.** Three weights only. More than three and a user cannot
  predict their own results.
- **Changing the Firecrawl search query or the domain deny list.** Those belong
  to `specs/firecrawl-discovery.md` and are measured there.

This branch starts from `main`. Run `npm ci` first and confirm the output
contains `@agentmail/convex@0.1.0 ✔`. Without the patch, `npx convex dev` fails.

## 4. The criteria

Seven criteria. Each carries its own weight.

| Criterion | Selected values | Extracted from |
|---|---|---|
| `bedrooms` | 0, 1, 2, 3, 4, 5, 6 | unit |
| `bathrooms` | 1, 1.5, 2 — where 2 means two or more | unit |
| `sqft` | a min, a max, or both | unit |
| `floors` | 1, 2, 3 — where 1 is ground or first, 3 is third or higher | unit |
| `pets` | `cat`, `dog` | page |
| `leaseMonths` | 1, 6, 9, 12 — where 1 is month to month | page |
| `amenities` | see below | page |

Nine amenities, each weighted on its own:

`parking`, `laundry`, `dishwasher`, `airConditioning`, `balcony`, `gym`,
`pool`, `elevator`, `furnished`

`laundry` keeps its current meaning: in-unit laundry, not a shared laundry room.
Keep that sentence in the extraction prompt.

Rent and move-in date are not criteria. Rent stays a range and stays a must.
Move-in date stays a single date and stays unranked; it is already reported in
`unknowns`.

### Why floor is a criterion and not a gate

A floor plan page states a floor level perhaps a quarter of the time. Weighted
`must`, a floor preference would push most good listings into the greyed group
for a fact the page never published. The `unconfirmed` score of 0, defined in
Task 4, is what makes this criterion safe. Do not add a rule that treats an
unconfirmed floor as a conflict.

There is no "top floor" value. The extractor cannot know a building's floor
count from a floor plan page. Do not add one.

## 5. Tasks

Complete the tasks in order. Each depends on the one before it. Stop at every
checkpoint — section 9.

### Task 1 — Schema, migration, and validation

Existing `users` and `searches` rows hold the old `preferences` shape. A schema
that requires the new shape rejects them on deploy. Do this task in three steps,
in order, and deploy between steps 1 and 2.

**Step 1 — widen.** In `convex/schema.ts`, replace the `preferences` object with
a shape where every old field and every new field is optional. Deploy. Existing
rows now validate.

**Step 2 — migrate.** Add `convex/migrations.ts` with one `internalMutation`
named `flexibleFilters`. It reads every `users` row and every `searches` row,
and rewrites any `preferences` value that still carries the old shape:

- `bedrooms: 2` becomes `bedrooms: { values: [2], weight: "must" }`
- `pets: "cat"` becomes `pets: { values: ["cat"], weight: "must" }`
- `pets: "none"` becomes `pets: { values: [], weight: "nice" }`
- `parking: true` becomes an `amenities` entry `{ key: "parking", weight: "must" }`
- `laundry: true` becomes an `amenities` entry `{ key: "laundry", weight: "must" }`
- `parking: false` and `laundry: false` add no entry
- `bathrooms`, `sqft`, `floors`, `leaseMonths` become empty criteria with
  weight `nice`
- `city`, `minRent`, `maxRent`, `moveIn`, `notes` carry over unchanged

Run it once with `npx convex run migrations:flexibleFilters`.

**Step 3 — tighten.** Remove the old fields and make the new fields required:

```ts
const weight = v.union(v.literal("must"), v.literal("want"), v.literal("nice"));
const values = v.object({ values: v.array(v.number()), weight });

export const preferences = v.object({
  city: v.literal("Ann Arbor, Michigan"),
  minRent: v.number(), maxRent: v.number(), moveIn: v.string(), notes: v.string(),
  bedrooms: values,
  bathrooms: values,
  floors: values,
  leaseMonths: values,
  sqft: v.object({ min: v.optional(v.number()), max: v.optional(v.number()), weight }),
  pets: v.object({ values: v.array(v.union(v.literal("cat"), v.literal("dog"))), weight }),
  amenities: v.array(v.object({ key: amenity, weight })),
});
```

Define `amenity` as a `v.union` of the nine literals in section 4.

Also in this task:

1. Add two columns to the `listings` table: `score: v.number()` and
   `mustMisses: v.number()`.
2. Update the validation in `convex/searches.ts:12`. It reads `p.bedrooms` as a
   number. It must instead reject a `bedrooms.values` array holding a value that
   is not an integer from 0 to 6, reject a `bathrooms.values` or `floors.values`
   or `leaseMonths.values` entry outside its listed set, reject a `sqft` range
   where `max` is below `min`, and reject a duplicate amenity key. Keep every
   rent, move-in, and notes test exactly as written.
3. Keep the one-search-per-minute limit at `convex/searches.ts:19` unchanged.

An empty `values` array is valid and means the criterion is unused. Do not
require a selection.

### Task 2 — Multi-select and weights in the form

Rewrite `src/Preferences.tsx`. A `<select>` cannot express several values
legibly, so each criterion becomes a row of toggle buttons.

Each criterion row holds, in this order:

1. A label.
2. A group of toggle buttons, one per value. A pressed button is selected.
   Several may be pressed at once.
3. A three-way weight control: `Must have` · `Really want` · `Nice to have`.

Requirements:

1. Use `<button type="button" aria-pressed>` for the value toggles and a radio
   group for the weight. Do not use a checkbox styled as a button; `aria-pressed`
   states the toggle's meaning to a screen reader and a checkbox does not.
2. The weight control is disabled while a criterion has no selected value. A
   weight on an unused criterion means nothing.
3. Default weights: `bedrooms` is `must`. Every other criterion is `nice`.
4. Amenities render as one grid of nine toggles. Selecting an amenity reveals its
   own weight control beside it.
5. Keep the rent inputs, the move-in date, and the notes textarea as they are.
6. Keep the form inside `Modal`. Keep the `fieldset disabled={pending}` wrapper.
   Keep the existing error handling.
7. `initial` seeds every control from the user's last saved preferences.

Add one sentence of help text above the criteria: a must-have moves a listing to
the bottom when it conflicts, and it is never a reason to hide one.

### Task 3 — Extract the new facts

Extend the extraction schema at `convex/discovery.ts:8`.

Per unit, add:

```ts
bathrooms: nullable("number"), sqft: nullable("number"), floor: nullable("number"),
```

Per page, add:

```ts
dishwasher: nullable("boolean"), airConditioning: nullable("boolean"),
balcony: nullable("boolean"), gym: nullable("boolean"), pool: nullable("boolean"),
elevator: nullable("boolean"), furnished: nullable("boolean"),
leaseMonths: { type: "array", items: { type: "number" } },
```

Keep `cats`, `dogs`, `parking`, `laundry`, `contactEmail`, `city`, `summary`,
`isListing`, and the `units` array as they are.

Extend the prompt at `convex/discovery.ts:78`. Add these sentences and change
nothing else:

- `bathrooms` is the bathroom count for the same floor plan as `bedrooms`.
- `sqft` is the plan's stated interior square footage. If the page states a
  range, return null.
- `floor` is the floor the plan sits on, counting the ground floor as 1. Return
  null unless the page states it. A garden level or a lower level is null, not 1.
- `leaseMonths` holds every lease length in months the property publishes. A
  month-to-month lease is 1. Return an empty array when no term is stated.
- Amenity fields are property-level and true only when the page states the
  property offers it.

Keep every existing sentence. In particular keep the instruction to return null
rather than a guess, and keep the sentence that defines `laundry` as in-unit.

### Task 4 — Score instead of drop

This is the task the branch exists for.

Delete the preference drops at `convex/discovery.ts:110`, `:117`, and `:118`.
Keep the structural tests: the empty-`units` return at `:105` and the
city-conflict return at `:108`.

Replace them with a scoring pass. For each unit, evaluate all seven criteria.

Points per weight:

| Weight | Points |
|---|---|
| `must` | 5 |
| `want` | 3 |
| `nice` | 1 |

Points per outcome:

| Outcome | Score contribution | Goes to |
|---|---|---|
| confirmed | `+points` | `matches` |
| unconfirmed | `0` | `unknowns` |
| conflicted | `−points` | `unknowns` |

A criterion with no selected values contributes nothing and adds no line to
either array.

Matching rules:

- `bedrooms`, `floors`, `leaseMonths` — confirmed when the extracted value is in
  the selected array. `floors` value 3 matches any extracted floor of 3 or more.
- `bathrooms` — confirmed when the extracted value is in the selected array.
  Value 2 matches any extracted count of 2 or more.
- `sqft` — confirmed when the extracted value falls inside the stated bounds. An
  absent bound does not constrain.
- `pets` — confirmed when every selected animal is allowed. Conflicted when any
  selected animal is stated as not allowed. Unconfirmed otherwise.
- `amenities` — one criterion per selected amenity, scored on its own.

`mustMisses` counts the criteria weighted `must` whose outcome is conflicted.
An unconfirmed must-have is not a must miss.

Rent stays a hard range but stops dropping the unit. A rent outside
`minRent`–`maxRent` scores `−5` and counts as one must miss. A null rent stays
unconfirmed and keeps its current `"Rent not confirmed"` line.

Pass `score` and `mustMisses` to `addListing`. Widen its args in
`convex/searches.ts:61`.

Keep the `"Move-in availability and current pricing need confirmation"` line on
every listing. Keep the `p.notes` line. Keep the `matches`/`unknowns` label
wording already in use for pets, parking, and laundry.

Replace the `drops` counter logged at `convex/discovery.ts:145` with a
`scored` counter holding the unit count and the count with `mustMisses > 0`.
A unit is no longer dropped, so a drop count would always read zero.

### Task 5 — Group, sort, and grey out

**Server.** In `convex/searches.ts:36`, sort the listings the `results` query
returns:

1. `mustMisses` ascending
2. `score` descending
3. `rent` ascending, with a null rent last

Cap the `mustMisses > 0` portion at 20 rows. Return the count that was cut so the
UI can state it.

**Client.** In `src/Dashboard.tsx:52`, split the sorted array into three groups
and render a heading before each. Render nothing for an empty group.

| Group | Condition | Heading |
|---|---|---|
| A | `mustMisses === 0` and no `unknowns` beyond the standing two | `Has everything you asked for` |
| B | `mustMisses === 0` | `Close — a few details to confirm` |
| C | `mustMisses > 0` | `Missing something you marked must-have` |

The two standing `unknowns` are the move-in line and the notes line. They appear
on every listing and must not keep a listing out of group A.

Group C cards render greyed: reduced opacity, muted text, no card shadow. They
stay fully readable and fully interactive. The link opens and the follow-up
button works. Do not set `pointer-events: none` and do not lower the text
contrast below 4.5:1 — a greyed card is de-emphasised, not disabled.

Each group C card names what it missed, above the summary: `Misses: 2 bedrooms,
parking`. Read those from the conflicted `unknowns` lines.

Add a count of satisfied criteria next to the price on every card:
`4 of 6 preferences`. Count criteria with selected values; a confirmed criterion
counts.

Update the summary line at `src/Dashboard.tsx:51` to state the group A and B
count, then the group C count: `12 matches · 8 missing a must-have`.

Update the saved-search picker at `src/Dashboard.tsx:31`. It reads
`s.preferences.bedrooms` as a number. Render the selected bedroom values joined
by a comma, and `Any` for an empty array.

### Task 6 — Update the inquiry draft

The draft at `src/Dashboard.tsx:72` reads `p.bedrooms`, `p.pets`, `p.parking`,
and `p.laundry` in their old shapes. Rewrite it against the new shape.

1. Bedrooms: `a 1 or 2 bedroom apartment` for several values, `a studio` for 0.
2. Pets: name every selected animal in one sentence.
3. Amenities: name the `must` and `want` amenities in one sentence. Leave the
   `nice` ones out; an email that lists nine requirements does not get answered.
4. Add one sentence naming the criteria the listing left unconfirmed, so the
   email asks the property the questions the page did not answer.

Keep the subject line, the length cap, and the closing paragraph as they are.

## 6. Tests

### `tests/discovery.test.ts`

Every fixture uses the old single-value `preferences` shape. Update them all.

Keep these tests passing unchanged in intent:

- `"excludes known conflicts and listings outside Ann Arbor"` — the Ypsilanti
  case must still drop. City is structural.
- `"empty unit arrays insert nothing regardless of isListing"`
- `"one failed scrape preserves the other results"`
- `"pages with floor plans are kept when isListing is false or null"`

Rewrite these, because they assert the behaviour this branch removes:

- `"a page with five units inserts two when three rents exceed the budget"` — it
  must now insert five, with three carrying `mustMisses: 1`.
- `"unit conflicts do not discard other units and each listing has its own
  unknowns"` — no unit is discarded now; assert the per-unit scores.
- `"logs distinguish rejected pages, empty unit arrays, and fully filtered
  units"` — assert the `scored` counter from Task 4, not the drop counter.
- `"overriding isListing keeps city, rent, and bedroom conflicts excluded"` —
  only the city conflict still excludes.

Add these:

1. A search selecting bedrooms `[1, 2]` inserts both a 1 bedroom unit and a
   2 bedroom unit, each with `mustMisses: 0`.
2. A 3 bedroom unit under that same search inserts with `mustMisses: 1` and a
   negative contribution to `score`.
3. A unit whose page states no floor inserts with the floor criterion in
   `unknowns` and no change to `score`.
4. A `want` amenity that the page confirms adds 3. The same amenity weighted
   `nice` adds 1.
5. An amenity the page states as absent subtracts its points and lands in
   `unknowns`.
6. `floors: [3]` matches an extracted floor of 5.
7. `bathrooms: [2]` matches an extracted count of 2.5.
8. A criterion with an empty `values` array adds no line to `matches` or
   `unknowns` and leaves `score` unchanged.
9. Two units on one page with different scores are both inserted.

### `tests/browser/app.spec.ts`

10. Selecting two bedroom values and submitting starts one search.
11. The weight control is disabled until a value is selected.
12. A group C card's `View listing` link is reachable by keyboard and its
    follow-up button is not disabled.

## 7. Acceptance criteria

All must pass.

1. `npm run typecheck` reports no error.
2. `npm test` passes, including the nine new unit tests from section 6.
3. `npm run test:e2e` passes, including the three new browser tests.
4. One live search with bedrooms `[1, 2]` inserts listings of both counts.
5. No live search inserts fewer listings than the same search ran on `main`.
6. Every inserted listing carries a `score` and a `mustMisses` value.
7. Results render in three groups. A group with no listings renders no heading.
8. A greyed group C card opens its listing link and its follow-up button works.
9. `npx convex run migrations:flexibleFilters` has been run and no row carries
   the old preferences shape.
10. The inquiry draft names several bedroom counts in one sentence.

Report the stage counts from the final live run and the score range across the
inserted listings.

## 8. Verification commands

```sh
npm run typecheck
npm test
npx convex logs
npx convex data listings --limit 10
npx convex run migrations:flexibleFilters
```

Run the live search through the running app. Start `npx convex logs` before
submitting. `npm run test:e2e` creates an account and spends Firecrawl credits —
run it once, at Task 5, not at every checkpoint.

Searches are rate limited to one per minute per account.

## 9. Checkpoints

Stop after every task. Do not start the next until the user replies.

At each stop, in order:

1. Run `npm run typecheck` and `npm test`. Report each result.
2. Print the list of changed files.
3. Print 2 or 3 lines stating what changed and why.
4. Print the exact git commands and write the commit message. Do not run them.

```
=== CHECKPOINT — task 4 of 6 ===

typecheck: pass
tests:     pass (34 passed)

Changed:
  convex/discovery.ts
  convex/searches.ts
  tests/discovery.test.ts

What changed:
  - Removed the three preference drops. A conflict now subtracts points.
  - Added score and mustMisses to every inserted listing.
  - Replaced the drop counter with a scored counter; nothing is dropped now.

Check this:
  Run one search with bedrooms [1, 2]. Report the score range.

Commit:
  git add convex/discovery.ts convex/searches.ts tests/discovery.test.ts
  git commit -m "task 4: score listings instead of dropping them"

Waiting for your review. Reply "continue" to start task 5.
```

If a test fails, stop. Report the failure. Do not start the next task.

## 10. Do not do

- Do not run `git commit`. Do not run `git push`. Print the command instead.
- Do not drop a unit or a page for a preference. Only the empty-`units` test and
  the city-conflict test may drop.
- Do not treat an unconfirmed fact as a conflict. Unconfirmed scores 0.
- Do not set `pointer-events: none` on a group C card, and do not lower its text
  contrast below 4.5:1.
- Do not change the Firecrawl search query or `excludeDomains`. That is
  `specs/firecrawl-discovery.md`.
- Do not remove the instruction that tells the model to return null instead of a
  guess. A wrong value is worse than an unknown value.
- Do not remove the check that an extracted email address appears in the page
  markdown.
- Do not remove the sentence defining `laundry` as in-unit laundry.
- Do not add a fourth weight, a numeric weight, or a slider.
- Do not add a neighborhood, distance, or utilities filter.
- Do not send email.
