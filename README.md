# Apartment Hunter

A React + TypeScript + Vite app for finding apartments in Ann Arbor, Michigan,
with Convex Auth v2, Firecrawl search, and AgentMail inquiries.

## Local development

```sh
npm ci
npx convex deployment select dev/hosting
npm run dev:backend
```

This `hosting` branch uses the isolated `dev/hosting` deployment
(`dutiful-basilisk-521`), which has its service keys configured. Selecting it
writes `.env.local` with the deployment and public frontend URL. Keep the
backend watcher and frontend running from the same checkout.

The shared `affable-chipmunk-297` deployment may run a different feature branch.
Its newer weighted preferences schema is incompatible with this branch's form.
An error about a missing `preferences.amenities` field indicates this mismatch;
select `dev/hosting`, restart both development commands, and reload the browser.
Each deployment has separate accounts and data, so create an account when
using this isolated deployment for the first time.

In a second terminal:

```sh
npm run dev
```

Open the URL printed by Vite. Create a username/password account, enter the name
you'd like to see in your greeting, fill out the preferences modal, and start a
search. Your name, preferences, and search history are saved to your account.
Existing accounts without a saved name are prompted after sign-in.
Vite restarts when `.env.local` changes.

## Authentication

This hackathon prototype uses the Convex Auth v2 preview linked from the event
resources. The package uses the `reboot` preview build because the npm `alpha`
tag does not yet expose all the APIs in the current preview documentation.
The lockfile records the package integrity. This is an experimental dependency.

For a new deployment, run `npx @convex-dev/auth` to generate `AUTH_PRIVATE_KEY`
and `AUTH_JWKS` in Convex. Preserve the existing service component configuration.
The current dev deployment is already initialized. Account settings support
password changes; account recovery and email verification are not implemented.

## Service credentials

Keep `AGENTMAIL_API_KEY`, `FIRECRAWL_API_KEY`, and `OPENAI_API_KEY` in the
selected Convex deployment's environment settings. No local copies are needed.
Never prefix service secrets with `VITE_`, which exposes variables to the
browser. `OPENAI_MODEL` is optional and defaults to `gpt-5.1`.

`convex/drafts.ts` generates the inquiry email. `drafts.compose` sends the
listing's confirmed matches and its unconfirmed details to OpenAI and asks for a
message that raises each unconfirmed detail by name. Output is clamped to the
limits `inquiries.send` enforces. If the key is missing or the request fails,
the inquiry form falls back to a template draft, so the flow still works without
OpenAI configured. Run `npx convex run services:checkOpenai` to confirm the key
and model before relying on it.

`convex/discovery.ts` searches for Ann Arbor apartments and reads up to 15
pages using Firecrawl structured extraction. Known conflicts with budget,
bedrooms, pets, parking, or in-unit laundry are excluded. Missing details,
move-in availability, and free-text preferences remain explicitly unconfirmed.
This is a small search batch, not a complete inventory of available apartments.

Users can review and edit an inquiry for a listing with a published leasing
email. `convex/inquiries.ts` creates a per-user AgentMail inbox on the first
approved inquiry and queues the email. Repeated requests for the same listing
do not create duplicate inquiries. Conversations show delivery status and fetch
thread messages when the user clicks **Check replies**. This does not require
webhooks. A listing without an email links users to the original contact form.

Searches and conversations enforce ownership in the backend. Searches are
limited to one per minute per account, inquiries to ten per day. There are no
global abuse controls yet; public rollout needs a separate review. If preparation
fails before an outbound message exists, open **Follow up** on the same listing,
review the message, and send again. Already queued messages are not resubmitted.

The installed AgentMail 0.1.0 component needs a compatibility patch, applied
automatically by `patch-package` during `npm ci`. It exposes the inbox/thread
actions to the parent backend and declares the component's API key environment
variable. `convex/convex.config.ts` passes the key into the component. Keep the
patch until an upstream release includes these fixes; do not skip install scripts.

An admin can check credential presence without displaying values:

```sh
npx convex run setup:credentials
npx convex run health:check
npx convex run services:checkAgentmail
```

Credential presence does not verify whether an API key is valid. The AgentMail
check verifies read access only and reads/caches one existing inbox, if available;
it does not verify write access, create an inbox, or send a message.

## Checks

```sh
npm run build
npm test
```

This runs TypeScript checks and builds the frontend into `dist/`.
Run `npm run preview` to serve that build locally.

With the dev server running and Google Chrome installed, `npm run test:e2e`
runs an opt-in live browser test. It creates a test account and performs one
Firecrawl search, consuming service credits. It never sends email. The test
account and its search remain in the development database.
