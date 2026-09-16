# Apartment Hunter — agent instructions

Convex backend, React + Vite + TypeScript frontend. Built for the Convex All Gas
Hackathon. Submissions close Sept 22, 12:00 PM PT.

## Commands

```sh
npm run dev           # frontend (vite)
npm run dev:backend   # convex dev — needs deployment affable-chipmunk-297
npm run typecheck     # tsc --noEmit
npm test              # vitest, all mocked, no network
npm run build         # typecheck + vite build
```

Do not run `npm run test:e2e` unless asked. It creates an account and spends
Firecrawl credits.

## Git

Never run `git commit`, `git push`, or any git command that writes state. Print
the command and let the user run it.

Read-only git commands are fine.

## Backend rules

These hold everywhere in `convex/`.

1. Every public `query`, `mutation`, and `action` calls `requireUser(ctx)` from
   `convex/users.ts` and checks that the requested row belongs to that user.
2. Every function declares `args` validators. No untyped arguments.
3. `ConvexError` carries messages a user will read. Plain `Error` carries
   internal failures. Never put an internal detail in a `ConvexError`.
4. Only actions touch the network. Mutations and queries never call an external
   API. An action calls a network API, then calls an `internalMutation` to write.
5. Operations that cost money get a rate limit. Searches are capped at one per
   minute per user. Inquiries are capped at ten per day per user.
6. Never prefix a secret with `VITE_`. That exposes it to the browser.
7. No `"use node"`. Both sponsor components run in the standard Convex runtime.

## Frontend rules

1. Every error shown to a user is plain and actionable. Write "Please check your
   budget, bedrooms, and move-in date." Do not write "Validation failed."
2. Loading and empty states are required, not optional. Every list renders
   something when it is empty.
3. Interactive elements carry the right ARIA role. Errors use `role="alert"`.
   Status text uses `role="status"`.

## Style

Match the existing files. The house style is compact:

- Double quotes. Semicolons. `const` by default.
- Related short statements share a line. Small handlers fit on one line.
- Object literals stay inline when they fit.

Comments state why, not what. The existing comments are the model:

```ts
// One inaccessible listing must not discard other results.
// Admin-only diagnostic: return presence, never secret values.
```

Do not add a comment that repeats the code.

## Types

`strict` is on in `tsconfig.json`. Do not turn it off for a file.

Do not use `any`. Do not use `as unknown as X`. When data arrives from an
external API, narrow it with runtime checks, as `convex/discovery.ts` does:

```ts
const rent = typeof d.rent === "number" && d.rent >= 0 ? d.rent : undefined;
```

## Extraction rules

These protect the product's core claim, which is that every value has a source.

1. An extraction prompt must instruct the model to return `null` instead of a
   guess. A wrong value is worse than an unknown value.
2. Never trust an email address the model returns. Confirm that the address
   appears in the page markdown before you store it.
3. Drop a candidate only when an extracted value conflicts with the user's
   brief. Never drop a candidate because a value is missing. A missing value is
   the case the product exists to solve.

## Tests

`tests/` uses vitest with `convex-test`. External clients are mocked with
`vi.mock`. No test reaches the network. No test sends email.

Add a test when you add a branch to discovery filtering or to ownership checks.
Those two areas hold every existing test for a reason.

## Branch ownership

Two people work in parallel. Respect the split.

| Files | Owner |
|---|---|
| `convex/discovery.ts`, `convex/searches.ts`, `tests/discovery.test.ts` | Firecrawl branch |
| `convex/inquiries.ts`, `convex/http.ts`, `convex/crons.ts` | AgentMail branch |
| `convex/schema.ts` | Both. Change it only when the task says to. |

Never change `convex/schema.ts` as a side effect of another task. A schema
change causes a merge conflict that blocks the other branch.

## Specs

Task specs live in `specs/`. When a spec covers the work, follow it exactly and
do not widen the scope. Report anything the spec does not cover instead of
deciding it yourself.

## Out of scope

Applications, payments, tour scheduling, roommate matching, other cities, a
mobile app, SMS, and phone calls. Do not build them.
