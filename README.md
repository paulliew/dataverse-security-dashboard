# Dataverse security dashboard

A responsive, sample-data-first dashboard for **Dataverse Agent user creation trends**. Explore daily new Agent users alongside a separate cumulative distinct Agent users chart and accumulated distinct organizations and mapped tenants to date. All cumulative counts include available history before the displayed range. This first feature measures creation/adoption, **not** runtime usage, security posture, enabled-user inventory, or sign-ins.

The separate **Agents per organization** view shows illustrative Agent-user detections over the **past week (rolling 7 days / 168 hours) for WRR**, deduplicated across the whole week and both authentication and provisioning sources. It is not creation-based and does not change the existing creation trends.

**By default, everything shown is synthetic.** An optional private production snapshot can replace **only Agents per organization**; creation charts, cumulative counts, daily tables, tenant mappings and CSV remain synthetic. Mixed mode is explicitly labeled. The application executes no Dataverse, Microsoft Graph or production analytics queries and stores no production credentials. Future security features are labeled Planned, not implemented.

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

The default range starts **90 UTC dates before today, through today inclusive**: 91 aligned daily buckets. For example, on October 23, 2026 it starts July 25, 2026. Synthetic history begins 120 UTC dates before today (June 25, 2026 in that example), so cumulative user, organization and tenant counts have a baseline before the chart starts. The dataset is generated deterministically relative to the UTC date when the page loads; today is a full illustrative sample, not measured partial-day telemetry. Reload after midnight to advance the anchor date.

Use the date-range selector, hover charts, or focus a chart and use Left/Right/Home/End to inspect dates. The date input synchronizes all four charts. “Show daily data” exposes an accessible table; “Export CSV” downloads the selected daily series with a synthetic-data column and filename. “How it works” documents the definitions in-app.

## Identity terminology

Microsoft describes Dataverse Agent users as AI agents provisioned using enterprise-managed Microsoft Entra agent identities and governed through Dataverse roles. Do not treat human users, application users, parent Entra agent identities, and agent user accounts as interchangeable.

- [Microsoft Entra agent's user account](https://learn.microsoft.com/en-us/entra/agent-id/agent-users): a distinct user identity linked one-to-one to a parent agent identity; it is optional and has separate identifiers.
- [Dataverse Agent users release plan](https://learn.microsoft.com/en-us/power-platform/release-plan/2026wave1/data-platform/create-dataverse-agent-users-entra-agent-identity): describes provisioning and role-based access. **This page is archived as of October 2026** and is conceptual background, not evidence of current feature availability or a verified telemetry schema.

## Metric semantics

The provided correlation requirements are implemented against a **sanitized normalized event contract**, without publishing internal service, database, or trace identifiers:

1. Group all available traces by nonempty `correlationId`.
2. Require an Agent user identification with `userObjectId` and `organizationId`, a creation event, and an apply-user **or** force-sync operation in that correlation.
3. Assign the correlation to its earliest creation-event timestamp, in UTC. **Correlate before date filtering**, so an identification before midnight can match a creation after midnight.
4. Count distinct created user object IDs within each visible UTC day, not correlation/operation counts. The Agent user card deduplicates across the selected date range.
5. The separate cumulative Agent users chart counts distinct created user object IDs from **all available qualifying creation history through the end of each UTC date**, including before the selected range. The same user across organizations, correlations, or dates counts once. Do not sum daily distinct user counts; a user may occur on multiple dates. The existing daily chart and selected-period user card are unchanged.
6. For each displayed day, count distinct organization IDs from **all available qualifying creation history through the end of that UTC date**, including history before the selected range. Repeated organizations across users, operations, and dates count once.
7. Look up those organizations in organization details and count distinct nonempty mapped tenant IDs through that date. Several organizations can map to one tenant; that tenant counts once. An unmapped organization still contributes to accumulated organization counts and its creations still contribute to user counts.

Organization and tenant cards show accumulated distinct counts through the range's end date (today in the UI); changing only the visible start date does not reset the baseline or alter shared dates' accumulated counts in any cumulative chart. **Never sum daily distinct counts to produce a distinct-to-date count.** The aggregator seeds user/organization/tenant sets with pre-range history, then adds each day's identities and emits the sizes of those sets. Events after the range's end date are excluded.

These are users associated with qualifying creation events, not a claim that each ID's first-ever creation was verified against historical inventory. Cumulative users, organizations and tenants represent **available-history adoption**, not verified lifetime totals or currently enabled populations. No-creation sample days show zero daily new users and carry forward all accumulated counts. A future live adapter must distinguish observed zero from unavailable telemetry.

Tenant mapping coverage = organizations in all available qualifying history through the end date with a nonempty tenant mapping / all organizations in that history. The sample includes pre-range history, progressive organization adoption, multiple organizations per tenant, one unmapped organization, no-creation days, both qualifying operation types, and a cross-midnight correlation. Exact duplicate mapping rows cannot cause join fan-out. Conflicting nonempty mappings and ambiguous correlation identities produce explicit errors rather than selecting arbitrary values. A source adapter must preserve these invariants and validate input.

CSV columns are `date_utc`, `new_agent_users_daily`, `agent_users_distinct_to_date`, `organizations_distinct_to_date`, `mapped_tenants_distinct_to_date`, and `data_mode`. Table headers, chart readouts, and accessible announcements use the same daily-versus-accumulated definitions.

## Agents per organization: detection query

The supplied report query merges sketches globally and returns overall identities, organizations and source-specific organization/agent pairs. It does **not** return agents per organization because it discards organization IDs before the final aggregation.

[`queries/agents-per-organization.kql`](queries/agents-per-organization.kql) is a **sanitized template**, not a runnable production query. Its fictitious normalized views expose `Timestamp`, `OrganizationId` and `AgentId` after verified source-specific Agent-user detection filters. A private adapter must implement the authentication source's detection/confirmation signals and the provisioning source's explicit Agent-user identification signals, including extraction and validation of the user ID. No creation event, operation or correlation is required for this view. The adapter must include all approved clusters for each source and report incomplete coverage rather than silently treating missing clusters as zero. Actual source names, filters and infrastructure configuration are deliberately not published here.

The template keeps `OrganizationId` while computing accuracy-2 HLL sketches per organization and source, then merges sketches across sources for each organization. Merge sketches across clusters before estimating counts; do not sum per-cluster or per-source distinct counts. These KQL counts are approximate. The template has not been executed against production or validated against a confirmed schema.

The sample uses `{ timestamp, organizationId, agentId, source: 'authentication' | 'provisioning' }` records and exact sets in `src/detections.ts`. Its separate WRR window is `[page-load time minus 7 days, page-load time)` in UTC: a rolling 168 hours, not the previous calendar week. The KQL template uses the same seven-day window ending at query execution time. Lowercase IDs are deduplicated within each organization across the whole week and both sources; blank IDs are excluded. Never sum daily distincts to compute weekly distinct agents. Both timestamps are shown. Repeated detections are not operations or additional agents. One agent in multiple organizations contributes to each organization row but only once to the global identity total. Source columns overlap and cannot be added to get the union. Source pair cards count distinct organization/agent pairs, not globally distinct identities. Only organizations with qualifying detections are listed; an absent organization does not imply it has no Agent users.

Fixtures include repeat detections across days, signals older than 24 hours, source overlap, shared identities across organizations and single-source identities. The detection view uses neither creation correlations nor tenant mappings and does not claim inventory completeness, sign-ins, or report reconciliation. The existing CSV export remains creation-trend-only; detection rows appear in their own accessible table.

## Private production detection snapshots

Run the approved seven-day detection query externally through authenticated, read-only analytics access. Use strict source-group expansion and fail on unavailable sources rather than silently accepting missing clusters. The public KQL template intentionally uses fictitious normalized views: adapt it **privately**, never by committing production infrastructure names or filters. It returns one `Snapshot` string containing JSON, including per-organization rows and independently merged global HLL totals. Save the **full cell value**, not the shortened grid preview, as a private JSON file **outside the repository**. Do not copy raw production rows, screenshots, exports or the operational query into this public repo.

Create an ignored `.env.local` file with an absolute private snapshot path:

```dotenv
DETECTION_SNAPSHOT_PATH='C:\private-data\agent-detections.json'
```

Run or restart `npm run dev`, then open `http://127.0.0.1:5173/#detections`. `npm run preview` also supports the private endpoint when served through Vite. Do not expose either server on a network interface. A static file host does not implement this endpoint.

The read-only `/api/detection-snapshot` endpoint accepts localhost requests only, serves with `Cache-Control: no-store`, validates the snapshot, and never copies it into build assets. Unconfigured local servers show explicitly labeled synthetic data. A configured missing or invalid snapshot produces an explicit error and **no detection counts**, not synthetic substitutes or zeros. Refreshing the page rereads the file; it does not rerun production queries. Keep `.env.local` and the private snapshot when resuming locally; neither is backed up by pushing the public branch.

Snapshot contract (illustrative structure; all counts below are placeholders):

```typescript
{
  version: 1;
  dataMode: 'production';
  countMethod: 'approximate-hll2';
  coverage: 'configured-source-groups';
  startTime: string; // UTC ISO timestamp, inclusive
  endTime: string;   // UTC ISO timestamp, exclusive; exactly 168 hours later
  rowCount: number;  // exact number of organization rows, used to reject truncation
  rows: { organizationId: string; agents: number; authentication: number; provisioning: number }[];
  totals: { agents: number; organizations: number; authenticationPairs: number; provisioningPairs: number };
}
```

The table paginates 100 organizations at a time; it does not discard the remaining rows. Global cards use the query's merged sketches, **not sums of row estimates**. The approximate global organization estimate may differ from the exact number of organization rows. The window timestamps are fixed to snapshot execution, not page load; inspect the end timestamp before using it for WRR. Producing a new snapshot replaces the seven-day window. No incremental collector, scheduler, lifetime inventory or persistent identity history is implemented.

Coverage means the **configured source groups**, not independently verified worldwide/sovereign-cloud coverage or complete telemetry. Query success cannot establish that every existing Agent-user identity generated one of the specified detection signals. These counts measure detected identities, not running/active agents or all existing identities.

## Architecture & later live integration

| File | Responsibility |
| --- | --- |
| `src/sampleData.ts` | Synthetic provider and organization-details fixtures |
| `src/analytics.ts` | Typed event/mapping contracts, correlation, exact distinct UTC aggregations |
| `src/detections.ts` | Independent detection-window aggregation and exact per-organization/source deduplication |
| `src/snapshot.ts` | Validates private production detection snapshots and preserves independently merged totals |
| `vite.config.ts` | Read-only localhost snapshot endpoint; private path loaded only on the server |
| `queries/agents-per-organization.kql` | Sanitized, approximate HLL per-organization query template |
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

For future live integration, implement an authorized server-side adapter that normalizes verified sources to these contracts. Do not put production credentials or internal queries in browser code. Resolve organization-details schema, tenant authorization, identifier scoping, mapping freshness, retention, late events and correlation completeness first. Fetch correlation context outside the display window (or expand matching correlation IDs) before aggregation; an arbitrary one-day padding cannot guarantee complete correlations. Accumulated distinct user/organization/tenant queries must retain all available pre-range creation history (or an exact historical identity baseline), not filter to the display range before deduplicating. Keep the existing global source coverage, deduplicate identities across sources, and report the earliest available history and any gaps explicitly; do not imply lifetime completeness from retained telemetry. Expose completeness and unmapped/conflicting records explicitly. Only a private detection-snapshot reader is included; live authentication, query execution and creation-data import remain future work. This repository change does not modify any external production dashboard or email-report query.

Google Fonts supplies DM Sans and Manrope when available; system sans-serif fallbacks work offline. There are no telemetry SDKs or analytics trackers.

## Validation

```powershell
npm test
npm run build
npx playwright install chromium
npx playwright test
```

The browser suite starts a temporary Vite server on port 4173 if none is already running there. Sample data and tests contain no real identifiers or production telemetry.
