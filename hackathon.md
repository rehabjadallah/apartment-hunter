# Hackathon log

- **Project:** apartment-hunter
- **Event:** Convex All Gas Hackathon
- **What it does:** Shows signed-in users Ann Arbor apartments that meet their selected filters and lets them review rental inquiries before sending.
- **Live app:** not deployed
- **Repo:** https://github.com/rehabjadallah/apartment-hunter
- **Frontend:** Convex static hosting
- **Convex deployment:** https://affable-chipmunk-297.convex.cloud
- **Components:** @convex-dev/auth (core, password, username), @convex-dev/static-hosting
- **Convex features:** schema, indexes, queries, mutations, actions, scheduled functions, realtime queries, HTTP routes
- **Auth:** Convex Auth v2 preview
- **AI models:** none
- **Started:** 2026-09-04T19:57:21Z
- **Last updated:** 2026-09-18T20:10:53Z

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
Synced the backend to the existing dev deployment. The frontend runs locally; no public frontend is deployed.
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
Merged discovery work into main, added profile naming and a missing-contact tooltip, and configured Convex static hosting; no public frontend URL is documented (`src/NamePrompt.tsx`, `convex/users.ts`, `convex/convex.config.ts`, `convex/http.ts`).
Added multi-select bedrooms, bathrooms, floor, square footage, pets, lease terms, and amenities with saved-preference migration (`convex/schema.ts`, `convex/migrations.ts`, `src/Preferences.tsx`).
Replaced weighted fallback groups with confirmed matches for every selected filter; blank filters impose no restriction, and results sort by rent. Move-in availability and free-text notes still need confirmation (`convex/searches.ts`, `src/Dashboard.tsx`).
Expanded extraction, added published complex names beneath floor-plan titles, and updated inquiry drafts for all selected amenities; older listings without a stored complex name omit the subtitle (`convex/discovery.ts`, `src/Dashboard.tsx`).
Session verification passed 119 unit tests, nine offline browser checks, typecheck, and the production build; updated the development backend. No email was sent during verification (`tests/discovery.test.ts`, `tests/browser/app.spec.ts`).
Working tree: removed the preference-count label from result cards; this edit remains uncommitted (`src/Dashboard.tsx`).
