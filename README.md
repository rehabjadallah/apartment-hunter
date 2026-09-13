# Apartment Hunter

A React + TypeScript + Vite app for finding apartments in Ann Arbor, Michigan,
with Convex Auth v2, Firecrawl search, and AgentMail inquiries.

## Local development

```sh
npm ci
npm run dev:backend
```

Choose the existing `apartment-hunter` project and the development deployment
that contains the service keys. Convex defaults to a personal dev deployment;
select the shared development deployment with
`npx convex deployment select affable-chipmunk-297`.
The CLI writes `.env.local` with the deployment and public frontend URL.

In a second terminal:

```sh
npm run dev
```

Open the URL printed by Vite. Create a username/password account, fill out the
preferences modal, and start a search. Preferences and search history are saved
to your account. Vite restarts when `.env.local` changes.

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

Keep `AGENTMAIL_API_KEY` and `FIRECRAWL_API_KEY` in the selected Convex
deployment's environment settings. No local copies are needed. Never prefix
service secrets with `VITE_`, which exposes variables to the browser.

`convex/discovery.ts` searches for Ann Arbor apartments and reads up to five
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
global abuse controls yet; public rollout needs a separate review. Failed
inquiries currently show an error and do not have a retry button.

An admin can check credential presence without displaying values:

```sh
npx convex run setup:credentials
npx convex run health:check
```

Credential presence does not verify whether an API key is valid.

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
