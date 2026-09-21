# Hackathon log

- **Project:** apartment-hunter
- **Event:** Convex All Gas Hackathon
- **What it does:** Shows signed-in users Ann Arbor apartments that meet their selected filters and lets them review rental inquiries before sending.
- **Live app:** https://affable-chipmunk-297.convex.site/
- **Repo:** https://github.com/rehabjadallah/apartment-hunter
- **Demo video:** pending
- **Social post:** pending
- **Frontend:** Convex static hosting
- **Convex deployment:** https://affable-chipmunk-297.convex.cloud
- **Components:** @convex-dev/auth (core, password, username), @convex-dev/static-hosting, @firecrawl/firecrawl-convex, @agentmail/convex
- **Convex features:** schema, indexes, queries, mutations, actions, scheduled functions, realtime queries, HTTP routes
- **Auth:** Convex Auth v2 preview
- **AI models:** OpenAI gpt-5.1 by default, overridable with `OPENAI_MODEL`, for inquiry drafting (`convex/drafts.ts`)
- **Started:** 2026-09-04T19:57:21Z
- **Last updated:** 2026-09-21T23:21:51Z

## Log

### 2026-09-04 - working tree
Started the build log and installed the project-local hackathon skill
(`.agents/skills/convex-hackathon-skill/SKILL.md` and `references/log-format.md`).
Verified Codex discovery of the official Convex plugin and all 19 skills, plus both MCP server handshakes.
Activation in the current session is pending a Codex restart. Hosting confirmation is pending.
The repository has no commits or application source to backfill; Started records the skill installation time.
No Convex application or hosting component has been initialized.

### 2026-09-04 - 4001252
Recorded the build log and project-local hackathon skill in the first commit
(`hackathon.md`, `.agents/skills/convex-hackathon-skill/SKILL.md`, and its `references/log-format.md`).
Set Started to the first commit time, replacing the initial installation-time fallback.
The repository still contains no application source or Convex configuration.

### 2026-09-13 - working tree
Built the React frontend with Convex Auth v2 sign-up, sign-in, password changes, and saved apartment preferences.
Added user-owned Ann Arbor searches, Firecrawl discovery and extraction, and results that flag unconfirmed details (`convex/searches.ts`, `convex/discovery.ts`).
Registered AgentMail and Firecrawl alongside auth; added reviewed inquiry sending, per-user inbox creation, delivery status, and on-demand thread retrieval (`convex/inquiries.ts`).
Synced the backend to the existing dev deployment. The frontend ran locally at this point; Convex static hosting was configured on 2026-09-18.
Eight backend tests pass for ownership, matching, partial scrape failures, and duplicate prevention; browser checks verify sign-up, search completion, saved preferences, sign-out, and sign-in.
No email was sent during verification. After refining discovery to prioritize property floor-plan pages, the live browser test returned one potential match and passed in about 23 seconds.

### 2026-09-17 - 3d2630a
Merged AgentMail compatibility fixes, retries for preparation failures before a message is queued, and a read-access-only health check (`bf49e91`, `convex/inquiries.ts`, `convex/services.ts`).
Completed discovery Tasks 1–7 on `firecrawl-discovery` and deployed them to dev; this branch is not yet merged into `main` (`convex/discovery.ts`, `tests/discovery.test.ts`).
Discovery requests 20 results, scrapes up to 15 unique pages in awaited batches of five, and allows one-hour cached responses; leasing-contact requirements stay in extraction rather than the search query.
Extracts every published floor plan, keeps unknown facts unconfirmed, accepts Ann Arbor Charter Township, and preserves rent and bedroom conflict filters; nonempty floor plans override the page's listing flag.
Logs selected URLs, stage and unit counts, filter drops, and distinct 403/429 reasons; failed scrapes are skipped without retries.
Verification on the discovery branch passed typecheck and all 34 tests. One final one-bedroom search extracted 44 units and saved 21 listings, five with confirmed published contact emails; five pages still hit 429s, and unrelated search results remain.

### 2026-09-18 - 69d8761
Merged discovery work into main, added profile naming and a missing-contact tooltip, and configured Convex static hosting at https://affable-chipmunk-297.convex.site/ (`src/NamePrompt.tsx`, `convex/users.ts`, `convex/convex.config.ts`, `convex/http.ts`).
Added multi-select bedrooms, bathrooms, floor, square footage, pets, lease terms, and amenities with saved-preference migration (`convex/schema.ts`, `convex/migrations.ts`, `src/Preferences.tsx`).
Replaced weighted fallback groups with confirmed matches for every selected filter; blank filters impose no restriction, and results sort by rent. Move-in availability and free-text notes still need confirmation (`convex/searches.ts`, `src/Dashboard.tsx`).
Expanded extraction, added published complex names beneath floor-plan titles, and updated inquiry drafts for all selected amenities; older listings without a stored complex name omit the subtitle (`convex/discovery.ts`, `src/Dashboard.tsx`).
Session verification passed 119 unit tests, nine offline browser checks, typecheck, and the production build; updated the development backend. No email was sent during verification (`tests/discovery.test.ts`, `tests/browser/app.spec.ts`).
Working tree: removed the preference-count label from result cards; this edit remains uncommitted (`src/Dashboard.tsx`).

### 2026-09-21 - working tree (`openai-drafting`)
Replaced the hand-built inquiry template with an OpenAI-generated draft so the model does real work in the product (`convex/drafts.ts`, `src/Dashboard.tsx`).
`drafts.compose` is a public action guarded by a `draftContext` internal query that reuses the ownership check pattern from `inquiries.threadAccess`; an unauthenticated or non-owning caller cannot spend credits.
The prompt receives the listing's confirmed matches and the details the page left unconfirmed, and is instructed to ask the leasing office about each unconfirmed detail by name.
Generated output is clamped to the subject and body limits `inquiries.send` already enforces, so a draft is always sendable; the request aborts after 15 seconds.
The previous template remains as the seeded fallback, so a missing key, a rate limit, or a slow response still yields a usable draft. The inquiry fields became controlled inputs so a late-arriving draft renders.
Added `services.checkOpenai`, which verifies the key and that the configured model is available without spending tokens.
Verification passed typecheck and 128 unit tests, nine of them new for ownership, clamping, and drafting failures (`tests/drafts.test.ts`). `services:checkOpenai` returned connected with gpt-4o-mini available. No email was sent.

### 2026-09-21 - 90d6a1e
Committed the AI inquiry drafting work previously logged as a working tree update (`convex/drafts.ts`, `src/Dashboard.tsx`).
Confirmed `gpt-5.1` as the code default, overridable with `OPENAI_MODEL`; the prompt asks about open details and renter notes while excluding known conflicts.
The inquiry form shows a drafting status and disables editing and sending until generation finishes; failures retain the template (`src/Dashboard.tsx`).
The result-card label removal is also committed (`3e2c18a`), and flexible filters are merged (`0c015fd`).
Reviewed committed source and draft tests for this entry (`tests/drafts.test.ts`); no new runtime checks were run.
