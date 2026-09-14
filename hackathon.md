# Hackathon log

- **Project:** apartment-hunter
- **Event:** Convex All Gas Hackathon
- **What it does:** Helps signed-in users find Ann Arbor apartments from their preferences and review rental inquiries before sending.
- **Live app:** not deployed
- **Repo:** https://github.com/rehabjadallah/apartment-hunter
- **Frontend:** not deployed
- **Convex deployment:** https://affable-chipmunk-297.convex.cloud
- **Components:** Convex Auth core, password, and username components
- **Convex features:** schema, indexes, queries, mutations, actions, scheduled functions, realtime queries
- **Auth:** Convex Auth v2 preview
- **AI models:** none
- **Started:** 2026-09-04T19:57:21Z
- **Last updated:** 2026-09-13T22:21:04Z

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
