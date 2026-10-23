# Dataverse security dashboard

A responsive, sample-data-first dashboard for **Dataverse Agent user creation trends**. Explore daily new Agent users, organizations with creations, and tenants mapped through organization details. This first feature measures creation/adoption, **not** runtime usage, security posture, enabled-user inventory, or sign-ins.

**Everything shown is synthetic. No Dataverse, Microsoft Graph, or production analytics queries are executed.** No credentials or environment configuration are required. Future security features are labeled Planned, not implemented.

## Run locally

Requires Node.js 22.18+ (or Node.js 24+) and npm.

```powershell
npm ci
npm run dev
```

Open the localhost URL printed by Vite (normally `http://127.0.0.1:5173`). For a production build:

```powershell
npm run build
npm run preview
```

The default range starts **90 UTC dates before today, through today inclusive**: 91 aligned daily buckets. For example, on October 23, 2026 it starts July 25, 2026. The dataset is generated deterministically relative to the UTC date when the page loads; today is a full illustrative sample, not measured partial-day telemetry. Reload after midnight to advance the anchor date.

Use the date-range selector, hover charts, or focus a chart and use Left/Right/Home/End to inspect dates. The date input synchronizes all three charts. “Show daily data” exposes an accessible table; “Export CSV” downloads the selected daily series with a synthetic-data column and filename. “How it works” documents the definitions in-app.

## Identity terminology

Microsoft describes Dataverse Agent users as AI agents provisioned using enterprise-managed Microsoft Entra agent identities and governed through Dataverse roles. Do not treat human users, application users, parent Entra agent identities, and agent user accounts as interchangeable.

- [Microsoft Entra agent's user account](https://learn.microsoft.com/en-us/entra/agent-id/agent-users): a distinct user identity linked one-to-one to a parent agent identity; it is optional and has separate identifiers.
- [Dataverse Agent users release plan](https://learn.microsoft.com/en-us/power-platform/release-plan/2026wave1/data-platform/create-dataverse-agent-users-entra-agent-identity): describes provisioning and role-based access. **This page is archived as of October 2026** and is conceptual background, not evidence of current feature availability or a verified telemetry schema.

## Metric semantics

The provided correlation requirements are implemented against a **sanitized normalized event contract**, without publishing internal service, database, or trace identifiers:

1. Group all available traces by nonempty `correlationId`.
2. Require an Agent user identification with `userObjectId` and `organizationId`, a creation event, and an apply-user **or** force-sync operation in that correlation.
3. Assign the correlation to its earliest creation-event timestamp, in UTC. **Correlate before date filtering**, so an identification before midnight can match a creation after midnight.
4. Filter creation records to the selected date range. Count distinct user object IDs and organization IDs within each day, not correlation/operation counts.
5. Look up each creation's organization in organization details; count distinct nonempty mapped tenant IDs per day. Several organizations can map to one tenant. An unmapped organization still contributes to user and organization counts.

Period cards deduplicate across the entire range, not by summing daily distincts. These are users associated with qualifying creation events, not a claim that each ID's first-ever creation was verified against historical inventory. Synthetic empty days are zero-filled. A future live adapter must distinguish observed zero from unavailable telemetry.

Tenant mapping coverage = organizations in qualifying creations with a nonempty tenant mapping / all organizations in those creations. The sample includes multiple organizations per tenant, one unmapped organization, no-creation days, both qualifying operation types, and a cross-midnight correlation. Exact duplicate mapping rows cannot cause join fan-out. Conflicting nonempty mappings and ambiguous correlation identities produce explicit errors rather than selecting arbitrary values. A source adapter must preserve these invariants and validate input.

## Architecture & later live integration

| File | Responsibility |
| --- | --- |
| `src/sampleData.ts` | Synthetic provider and organization-details fixtures |
| `src/analytics.ts` | Typed event/mapping contracts, correlation, exact distinct UTC aggregations |
| `src/main.ts` | Dashboard rendering, date inspection, methodology and CSV |
| `src/style.css` | Responsive styling, keyboard focus and reduced-motion support |
| `tests/analytics.test.ts` | Correlation, deduplication, mapping and date-boundary coverage |
| `tests/browser/dashboard.spec.ts` | Desktop/mobile interactions and CSV behavior |

`TraceEvent` is an illustrative normalized contract, **not a production table schema**:

```typescript
{
  correlationId: string;
  timestamp: string; // ISO 8601 with UTC Z or explicit offset
  kind: 'agentIdentified' | 'applyUser' | 'forceSync' | 'userCreated';
  userObjectId?: string; // required on qualifying identification
  organizationId?: string; // required on qualifying identification
}
```

The sanitized organization-details mapping is `{ organizationId: string; tenantId: string | null }`. Production table/column names are deliberately not assumed. Mapping snapshots are not historical tenant membership.

For future live integration, implement an authorized server-side adapter that normalizes verified sources to these contracts. Do not put production credentials or internal queries in browser code. Resolve organization-details schema, tenant authorization, identifier scoping, mapping freshness, retention, late events and correlation completeness first. Fetch correlation context outside the display window (or expand matching correlation IDs) before aggregation; an arbitrary one-day padding cannot guarantee complete correlations. Expose completeness and unmapped/conflicting records explicitly. No live adapter, authentication, production query, or source-column detection is included in this version.

Google Fonts supplies DM Sans and Manrope when available; system sans-serif fallbacks work offline. There are no telemetry SDKs or analytics trackers.

## Validation

```powershell
npm test
npm run build
npx playwright install chromium
npx playwright test
```

The browser suite starts a temporary Vite server on port 4173 if none is already running there. Sample data and tests contain no real identifiers or production telemetry.
