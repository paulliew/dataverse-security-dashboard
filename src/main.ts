import './style.css';
import { aggregateDaily, correlateCreations, daysBefore } from './analytics.ts';
import type { DailyMetric } from './analytics.ts';
import { loadSampleData } from './sampleData.ts';
import { aggregateDetections, aggregateTenantDetections } from './detections.ts';
import type { TenantDetectionCounts } from './detections.ts';
import { parseProductionSnapshot } from './snapshot.ts';
import type { ObservedCallVolume, ObservedWau } from './snapshot.ts';
import { completedWbrWeeks, observationStart, parseWbrSnapshot, weekOverWeek } from './wbr.ts';
import type { WbrSnapshot, WbrWeek, WeeklyMetric } from './wbr.ts';

const icons: Record<string, string> = {
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  agent: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12v2m8-2v2M9 17h6M1 11v5m22-5v5"/>',
  building: '<path d="M4 21V5h10v16M14 10h6v11M2 21h20M8 9h2m-2 4h2m-2 4h2m7-3h1m-1 3h1"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name: string, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const format = new Intl.NumberFormat('en-US');
const dateLabel = (day: string, long = false) => new Intl.DateTimeFormat('en-US', {
  month: long ? 'long' : 'short', day: 'numeric', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC',
}).format(new Date(`${day}T00:00:00Z`));
const source = loadSampleData();
const creations = correlateCreations(source.events);
let detections = aggregateDetections(source.detections,
  new Date(Date.parse(source.detectionEndTime) - 7 * 86_400_000).toISOString(), source.detectionEndTime);
let tenantDetections: TenantDetectionCounts | undefined = aggregateTenantDetections(
  source.detections, source.organizationDetails, detections.startTime, detections.endTime);
let tenantDetectionAsOf: string | undefined;
let productionDetections = false;
let detectionError = '';
let observedWau: ObservedWau | undefined;
let callVolume: ObservedCallVolume | undefined;
let wbrSnapshot: WbrSnapshot | undefined;
let wbrError = '';
let detectionPage = 0;
let tenantPage = 0;
let tenantDetectionPage = 0;
const detectionPageSize = 100;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
let range = 90;
let data = aggregateDaily(creations, source.organizationDetails, daysBefore(source.asOf, range), source.asOf);
let selectedIndex = data.daily.length - 1;
let tableVisible = false;
let sampleTrendsOpen = false;
type Metric = 'users' | 'organizations' | 'tenants';
const metrics: { key: Metric; title: string; description: string; color: string; icon: string }[] = [
  { key: 'users', title: 'New Agent users', description: 'Distinct user object IDs in qualifying creation correlations', color: '#008778', icon: 'agent' },
  { key: 'organizations', title: 'Organizations', description: 'Accumulated distinct organizations through each date', color: '#5779bb', icon: 'building' },
  { key: 'tenants', title: 'Tenants', description: 'Accumulated distinct mapped tenants through each date', color: '#a77b43', icon: 'layers' },
];
const chartMetrics: { key: Metric | 'cumulativeUsers'; title: string; description: string; color: string; icon: string }[] = [
  metrics[0],
  { key: 'cumulativeUsers', title: 'Cumulative Agent users', description: 'Accumulated distinct user object IDs through each date', color: '#7065b5', icon: 'agent' },
  ...metrics.slice(1),
];

function chart(metric: typeof chartMetrics[number], index: number): string {
  const values = data.daily.map(day => day[metric.key]);
  const max = Math.max(4, Math.ceil(Math.max(...values) / 4) * 4);
  const width = index < 2 && window.matchMedia('(min-width: 851px)').matches ? 900 : 450;
  const height = 222, left = 40, right = 16, top = 14, bottom = 32;
  const x = (i: number) => left + i / (values.length - 1) * (width - left - right);
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  const points = values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const value = max / 4 * i;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="grid-line"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${value}</text>`;
  }).join('');
  const labels = [0, Math.floor(values.length / 3), Math.floor(values.length * 2 / 3), values.length - 1]
    .map((i, n) => `<text x="${x(i)}" y="${height - 7}" text-anchor="${n === 0 ? 'start' : n === 3 ? 'end' : 'middle'}">${dateLabel(data.daily[i].day)}</text>`).join('');
  return `<article class="chart-card ${index < 2 ? 'primary-chart' : ''}" style="--series:${metric.color}">
    <div class="chart-heading"><div><div class="eyebrow">SYNTHETIC · ${metric.key === 'users' ? 'DAILY CREATIONS' : 'ACCUMULATED TO DATE'}</div><h2>${metric.title}</h2><p>${metric.description}</p></div>
    <span class="chart-symbol">${icon(metric.icon)}</span></div>
    <div class="chart-readout"><strong data-value="${metric.key}">${format.format(data.daily[selectedIndex][metric.key])}</strong><span data-chart-date>${dateLabel(data.daily[selectedIndex].day)}${selectedIndex === data.daily.length - 1 ? ' · today' : ''}</span><span class="daily-tag">${metric.key === 'users' ? 'daily distinct' : 'distinct to date'}</span></div>
    <svg class="trend-chart" data-metric="${metric.key}" role="img" aria-label="${metric.title}, synthetic ${metric.key === 'users' ? 'daily new creations' : 'accumulated distinct counts from all available history'}. Use left and right arrow keys to inspect dates." tabindex="0" viewBox="0 0 ${width} ${height}">
      <title>${metric.title} — synthetic ${metric.key === 'users' ? 'daily' : 'accumulated distinct'} trend</title>
      <defs><linearGradient id="fill-${metric.key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${metric.color}" stop-opacity=".17"/><stop offset="100%" stop-color="${metric.color}" stop-opacity=".01"/></linearGradient></defs>
      ${ticks}${labels}
      <polygon points="${left},${height - bottom} ${points} ${width - right},${height - bottom}" fill="url(#fill-${metric.key})"/>
      <polyline points="${points}" fill="none" stroke="${metric.color}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line class="selection-line" x1="${x(selectedIndex)}" x2="${x(selectedIndex)}" y1="${top}" y2="${height - bottom}"/>
      <circle class="selection-dot" cx="${x(selectedIndex)}" cy="${y(values[selectedIndex])}" r="4.5" fill="${metric.color}" stroke="white" stroke-width="2"/>
    </svg>
    <div class="chart-footer"><span><i class="legend-dot"></i> ${metric.key === 'users' ? 'Agent users created' : metric.title + ' to date'}</span><span>UTC · synthetic</span></div>
  </article>`;
}

function wauChart(): string {
  const heading = '<div class="section-heading"><div><div class="eyebrow">WRR · SUCCESSFUL-CALL ACTIVITY</div><h2 id="wau-title">Observed weekly active Agent users</h2><p>WAU within the detected cohort, not all existing Agent users.</p></div></div>';
  if (!observedWau) return `<section id="wau" aria-labelledby="wau-title">${heading}<p class="trend-note">Unavailable: no verified successful-call snapshot loaded. Detection counts are not used as a substitute for WAU.</p></section>`;
  const { daily, agents } = observedWau;
  const width = window.matchMedia('(min-width: 851px)').matches ? 900 : 450;
  const height = 222, left = 60, right = 20, top = 14, bottom = 32;
  const max = Math.max(4, Math.ceil(Math.max(...daily.map(row => row.agents)) / 4) * 4);
  const x = (index: number) => left + index / (daily.length - 1) * (width - left - right);
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  const points = daily.map((row, index) => `${x(index)},${y(row.agents)}`).join(' ');
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = max / 4 * index;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="grid-line"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${format.format(value)}</text>`;
  }).join('');
  const labels = [0, Math.floor(daily.length / 2), daily.length - 1].map((index, label) =>
    `<text x="${x(index)}" y="${height - 7}" text-anchor="${label === 0 ? 'start' : label === 2 ? 'end' : 'middle'}">${dateLabel(daily[index].day)}</text>`).join('');
  return `<section id="wau" aria-labelledby="wau-title">${heading}
    <article class="chart-card" style="--series:#126aab">
      <div class="chart-heading"><div><div class="eyebrow">PRODUCTION SNAPSHOT · APPROXIMATE HLL COUNTS</div><h2>At least one successful non-batch Dataverse API call</h2><p>Distinct Agent-user identities, deduplicated across organizations and days</p></div><span class="chart-symbol">${icon('agent')}</span></div>
      <div class="chart-readout"><strong id="wau-value">≈${format.format(agents)}</strong><span>observed WAU for the report week</span></div>
      <p class="range-caption">${detections.startTime} inclusive – ${detections.endTime} exclusive (UTC)</p>
      <svg class="wau-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="wau-svg-title" aria-describedby="wau-svg-description">
        <title id="wau-svg-title">Observed WAU: approximately ${format.format(agents)} Agent-user identities</title>
        <desc id="wau-svg-description">Distinct successful callers accumulated from the report window's start through each UTC date. The last point is WAU for the whole report week. This is not a historical rolling-WAU trend. First and last UTC dates may be partial.</desc>
        ${ticks}${labels}<polyline points="${points}" fill="none" stroke="#126aab" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        ${daily.map((row, index) => `<circle cx="${x(index)}" cy="${y(row.agents)}" r="3" fill="#126aab"/>`).join('')}
      </svg>
      <div class="chart-footer"><span><i class="legend-dot"></i>Distinct successful callers accumulated within report week</span><span>UTC · production</span></div>
    </article>
    <p class="trend-note">Same-week detected cohort only. Callers must match both organization and Agent-user object ID. Qualifying API/SDK routes require HTTP 2xx (excluding 202) and error code 0. Batch requests, ExecuteMultiple and ExecuteTransaction are excluded; their outer responses do not prove child-call success. This is an observed subset, not a complete active-Agent inventory or proof of task completion. Telemetry gaps and unmatched identities can undercount WAU.</p>
    <p class="trend-note">The curve accumulates distinct callers inside this one report week; it never sums daily distinct counts. First and last dates may be partial. It is independent of the creation trend range.</p>
    <details class="daily-section"><summary>Show observed WAU data</summary><div class="table-scroll"><table><caption>Production observed WAU — within-week cumulative distinct successful callers (approximate)</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Distinct successful callers since window start</th></tr></thead><tbody>${daily.map(row => `<tr><th scope="row">${row.day}</th><td>${row.agents}</td></tr>`).join('')}</tbody></table></div></details>
  </section>`;
}

function callVolumeChart(): string {
  const heading = '<div class="section-heading"><div><div class="eyebrow">WRR · SUCCESSFUL-CALL VOLUME</div><h2 id="call-volume-title">Weekly Agent call volume</h2><p>Successful non-batch Dataverse calls within the same-week detected cohort.</p></div></div>';
  if (!callVolume) return `<section id="call-volume" aria-labelledby="call-volume-title">${heading}<p class="trend-note">Unavailable: no verified call-volume snapshot loaded. WAU and detection counts do not measure call volume.</p></section>`;
  const { daily, calls } = callVolume;
  const width = window.matchMedia('(min-width: 851px)').matches ? 900 : 450;
  const height = 222, left = 76, right = 20, top = 14, bottom = 32;
  const max = Math.max(4, Math.ceil(Math.max(...daily.map(row => row.calls)) / 4) * 4);
  const step = (width - left - right) / daily.length;
  const x = (index: number) => left + (index + .5) * step;
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = max / 4 * index;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="grid-line"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${format.format(value)}</text>`;
  }).join('');
  const labels = [0, Math.floor(daily.length / 2), daily.length - 1].map((index, label) =>
    `<text x="${x(index)}" y="${height - 7}" text-anchor="${label === 0 ? 'start' : label === 2 ? 'end' : 'middle'}">${dateLabel(daily[index].day)}</text>`).join('');
  return `<section id="call-volume" aria-labelledby="call-volume-title">${heading}
    <article class="chart-card" style="--series:#008778">
      <div class="chart-heading"><div><div class="eyebrow">PRODUCTION SNAPSHOT · DISTINCT REQUEST IDS</div><h2>Total successful Agent calls for the report week</h2><p>Repeated calls by the same identity count individually</p></div><span class="chart-symbol">${icon('agent')}</span></div>
      <div class="chart-readout"><strong id="call-volume-value">${format.format(calls)}</strong><span>observed successful calls this report week</span></div>
      <p class="range-caption">${detections.startTime} inclusive – ${detections.endTime} exclusive (UTC)</p>
      <svg class="volume-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="volume-svg-title" aria-describedby="volume-svg-description">
        <title id="volume-svg-title">Weekly Agent call volume: ${format.format(calls)} successful calls</title>
        <desc id="volume-svg-description">Daily successful non-batch calls within one rolling seven-day report window. Daily bars sum to the weekly total. First and last dates may be partial; this is not a historical series of weekly totals.</desc>
        ${ticks}${labels}${daily.map((row, index) => {
          const barWidth = step * .6;
          return `<rect x="${x(index) - barWidth / 2}" y="${y(row.calls)}" width="${barWidth}" height="${height - bottom - y(row.calls)}" rx="2" fill="#008778"><title>${row.day}: ${format.format(row.calls)} successful calls</title></rect>`;
        }).join('')}
      </svg>
      <div class="chart-footer"><span><i class="legend-dot"></i>Daily successful calls · summed for report week</span><span>UTC · production</span></div>
    </article>
    <p class="trend-note">Same eligibility and report window as observed WAU: HTTP 2xx except 202, error code 0, qualifying API/SDK routes, and no batch, ExecuteMultiple or ExecuteTransaction calls. Each organization/request ID counts once across duplicate telemetry; separate requests by the same Agent user count separately. One identity making ten calls adds ten calls but only one to WAU. Missing or conflicting request IDs reject the snapshot.</p>
    <p class="trend-note">Observed telemetry only, not all Agent traffic or completed business tasks. Bars show daily counts, not cumulative counts. First and last UTC dates may be partial. The report week does not change with the creation trend range.</p>
    <details class="daily-section"><summary>Show weekly call volume data</summary><div class="table-scroll"><table><caption>Production successful non-batch Agent calls — daily volumes sum to the report-week total</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Successful calls</th></tr></thead><tbody>${daily.map(row => `<tr><th scope="row">${row.day}</th><td>${format.format(row.calls)}</td></tr>`).join('')}</tbody></table></div></details>
  </section>`;
}

function tenantCallsChart(): string {
  const heading = '<div class="section-heading"><div><div class="eyebrow">WRR · TENANT ORIGINS</div><h2 id="call-tenants-title">Where Agent calls come from</h2><p>Successful calls attributed to environment tenants through organization details.</p></div></div>';
  const volume = callVolume, attribution = volume?.byTenant;
  if (!volume || !attribution) return `<section id="call-tenants" aria-labelledby="call-tenants-title">${heading}<p class="trend-note">Unavailable: no verified organization-to-tenant attribution loaded. Caller home tenants and sample mappings are not used as substitutes.</p></section>`;
  const { rows, unmappedCalls } = attribution;
  const wide = window.matchMedia('(min-width: 851px)').matches;
  const width = wide ? 900 : 450, left = wide ? 290 : 150, right = 76, step = 30, top = 12;
  const bars = rows.slice(0, 10).map(row => ({ label: row.tenantId, calls: row.calls, color: '#5779bb' }));
  if (rows.length > 10) bars.push({ label: `Other mapped tenants (${rows.length - 10})`, calls: rows.slice(10).reduce((sum, row) => sum + row.calls, 0), color: '#92a6bd' });
  if (unmappedCalls || !bars.length) bars.push({ label: 'Unmapped calls', calls: unmappedCalls, color: '#a77b43' });
  const height = top + step * bars.length + 12;
  const max = Math.max(1, ...bars.map(row => row.calls));
  const share = (calls: number) => `${volume.calls ? (100 * calls / volume.calls).toFixed(1) : '0.0'}%`;
  return `<section id="call-tenants" aria-labelledby="call-tenants-title">${heading}
    <article class="chart-card" style="--series:#5779bb">
      <div class="chart-heading"><div><div class="eyebrow">PRODUCTION SNAPSHOT · ORGANIZATION-DETAILS ATTRIBUTION</div><h2>Successful Agent calls by tenant</h2><p>Top 10 mapped tenants; remaining tenants grouped as Other</p></div><span class="chart-symbol">${icon('building')}</span></div>
      <div class="chart-readout"><strong id="call-tenant-count">${format.format(rows.length)}</strong><span>mapped tenants · ${format.format(volume.calls)} successful calls in the report week</span></div>
      <p class="range-caption">${detections.startTime} inclusive – ${detections.endTime} exclusive (UTC)</p>
      <svg class="tenant-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="tenant-svg-title" aria-describedby="tenant-svg-description">
        <title id="tenant-svg-title">Successful Agent calls by environment tenant: ${format.format(rows.length)} mapped tenants</title>
        <desc id="tenant-svg-description">Top ten tenants by call volume, with Other and Unmapped categories where needed. All chart categories reconcile with the weekly call total. Tenant names, full tenant IDs and shares of all weekly calls are available in the table.</desc>
        ${bars.map((row, index) => {
          const y = top + index * step, barWidth = row.calls / max * (width - left - right);
          const label = !wide && row.label.length > 20 ? `${row.label.slice(0, 8)}...${row.label.slice(-4)}` : row.label;
          return `<text x="${left - 10}" y="${y + 15}" text-anchor="end">${escapeHtml(label)}</text><rect x="${left}" y="${y}" width="${barWidth}" height="22" rx="3" fill="${row.color}"><title>${escapeHtml(row.label)}: ${format.format(row.calls)} calls (${share(row.calls)})</title></rect><text x="${left + barWidth + 8}" y="${y + 15}">${format.format(row.calls)}</text>`;
        }).join('')}
      </svg>
      <div class="chart-footer"><span><i class="legend-dot"></i>Mapped tenant calls + unmapped calls = weekly volume</span><span>UTC · production</span></div>
    </article>
    <p class="trend-note"><span id="unmapped-call-count">${format.format(unmappedCalls)}</span> unmapped calls (${share(unmappedCalls)} of all weekly calls) remain in the total, not attributed to a guessed tenant. Multiple organizations mapped to one tenant are combined; each request still counts once.</p>
    <p class="trend-note">Tenant IDs identify the environment's owning tenant, not the caller's home tenant or geographic location. Names are display labels from verified tenant metadata, not organization names or inferred legal customer names. Missing names are shown as Name unavailable. Latest available organization-details mappings were read at ${attribution.asOf}; historical tenant membership is not verified. Same successful non-batch scope as WAU and weekly call volume.</p>
    <div class="table-scroll"><table><caption>Production tenant call origins — tenant names and full IDs ranked by successful calls; share includes unmapped calls</caption><thead><tr><th scope="col">Tenant name</th><th scope="col" class="tenant-id">Tenant ID</th><th scope="col">Successful calls</th><th scope="col">Share of all weekly calls</th></tr></thead><tbody>${rows.slice(tenantPage * detectionPageSize, (tenantPage + 1) * detectionPageSize).map(row => `<tr><th scope="row" class="tenant-name">${escapeHtml(row.tenantName ?? 'Name unavailable')}</th><td class="tenant-id">${escapeHtml(row.tenantId)}</td><td>${format.format(row.calls)}</td><td>${share(row.calls)}</td></tr>`).join('')}<tr class="unmapped-tenant"><th scope="row">Unmapped calls</th><td class="tenant-id">Not attributed</td><td>${format.format(unmappedCalls)}</td><td>${share(unmappedCalls)}</td></tr></tbody></table></div>
    ${rows.length > detectionPageSize ? `<div class="section-heading"><span class="range-caption">Mapped tenants ${format.format(tenantPage * detectionPageSize + 1)}–${format.format(Math.min((tenantPage + 1) * detectionPageSize, rows.length))} of ${format.format(rows.length)}</span><div><button class="button" id="tenant-previous" ${tenantPage === 0 ? 'disabled' : ''}>Previous tenants</button> <button class="button" id="tenant-next" ${(tenantPage + 1) * detectionPageSize >= rows.length ? 'disabled' : ''}>Next tenants</button></div></div>` : ''}
  </section>`;
}

function productionOverview(): string {
  const heading = '<div class="section-heading"><div><div class="eyebrow">PRODUCTION · ROLLING SEVEN-DAY SNAPSHOT</div><h2 id="production-overview-title">Production overview</h2></div></div>';
  if (detectionError) return `<section id="production-overview" aria-labelledby="production-overview-title">${heading}<p>Production overview unavailable: the snapshot could not be loaded. No sample values are substituted for production counts.</p></section>`;
  const tenants = tenantDetections;
  return `<section id="production-overview" aria-labelledby="production-overview-title">
    ${heading}
    <p class="range-caption">${detections.startTime} inclusive – ${detections.endTime} exclusive (UTC). Rolling 7 days / 168 hours, not the sample creation date range.</p>
    <div class="kpi-grid">
      <article class="kpi"><div class="kpi-label">Detected Agent identities</div><div class="kpi-value">${format.format(detections.totals.agents)}</div><div class="kpi-note">Approximate HLL2 · distinct across organizations and sources</div></article>
      <article class="kpi"><div class="kpi-label">Detected organizations (estimate)</div><div class="kpi-value">${format.format(detections.totals.organizations)}</div><div class="kpi-note">Approximate HLL2 · ${format.format(detections.rows.length)} exact organization rows</div></article>
      <article class="kpi"><div class="kpi-label">Mapped tenants</div><div class="kpi-value">${tenants ? format.format(tenants.rows.length) : 'Unavailable'}</div><div class="kpi-note">${tenants ? 'Exact tenant groups from organization-details mappings' : 'Tenant detection aggregation not included in this snapshot'}</div></article>
      <article class="kpi"><div class="kpi-label">Unmapped organizations</div><div class="kpi-value">${tenants ? format.format(tenants.unmapped.organizations) : 'Unavailable'}</div><div class="kpi-note">${tenants ? 'Included in detections; no resolved tenant mapping' : 'Mapping coverage not included in this snapshot'}</div></article>
    </div>
    <p class="trend-note">These are detected identities, not new creations or current enabled inventory. Production creation history is not connected. The separate synthetic creation demo cannot be compared with these counts. Organization estimates can differ from exact row counts; identities shared across organizations count once globally. Coverage is limited to the configured source groups.</p>
  </section>`;
}

function wbrSection(): string {
  const identityStart = wbrSnapshot?.observationStart ?? observationStart;
  const startLabel = dateLabel(identityStart.slice(0, 10), true);
  const missingIdentities: WeeklyMetric = { status: 'unavailable', reason: 'Verified identity history from the observation start has not been loaded.' };
  const missingCalls: WeeklyMetric = { status: 'unavailable', reason: 'Verified calendar-week call volumes have not been loaded.' };
  const weeks: WbrWeek[] = wbrSnapshot?.weeks ?? completedWbrWeeks().map(week =>
    ({ ...week, identities: missingIdentities, calls: missingCalls }));
  const baseline = wbrSnapshot?.baseline.identities ?? missingIdentities;
  const latest = weeks.at(-1)!;
  const stale = Boolean(wbrSnapshot && latest.endTime !== completedWbrWeeks().at(-1)!.endTime);
  const complete = baseline.status === 'verified'
    && weeks.every(week => week.identities.status === 'verified' && week.calls.status === 'verified');
  const value = (metric: WeeklyMetric) => metric.status === 'verified' ? format.format(metric.value) : 'Unavailable';
  const growth = (current: WeeklyMetric, previous: WeeklyMetric) => {
    const change = weekOverWeek(current, previous);
    if (change !== undefined) return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
    return current.status === 'verified' && previous.status === 'verified'
      ? `N/A (zero baseline; +${format.format(current.value)} identities)` : 'Unavailable';
  };
  const endDay = (week: WbrWeek) => daysBefore(week.endTime.slice(0, 10), 1);
  const chart = (key: 'identities' | 'calls', title: string, color: string) => {
    const width = 450, height = 222, left = 64, right = 18, top = 26, bottom = 34;
    const values = weeks.map(week => week[key].status === 'verified' ? week[key].value : undefined);
    const hasValues = values.some(value => value !== undefined);
    const max = Math.max(4, ...values.filter((value): value is number => value !== undefined));
    const x = (index: number) => left + (index + .5) / 3 * (width - left - right);
    const y = (value: number) => height - bottom - value / max * (height - top - bottom);
    const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
    const marks = values.map((value, index) => {
      if (value === undefined) return `<text x="${x(index)}" y="${(top + height - bottom) / 2}" text-anchor="middle" class="wbr-missing">Unavailable</text>`;
      const label = `${endDay(weeks[index])}: ${format.format(value)} ${key === 'identities' ? 'accumulated identities' : 'successful calls'}`;
      const previous = values[index - 1];
      return key === 'identities'
        ? `${previous === undefined ? '' : `<line x1="${x(index - 1)}" y1="${y(previous)}" x2="${x(index)}" y2="${y(value)}" stroke="${color}" stroke-width="2.5"/>`}<circle cx="${x(index)}" cy="${y(value)}" r="5" fill="${color}"><title>${label}</title></circle>`
        : `<rect x="${x(index) - 25}" y="${y(value)}" width="50" height="${height - bottom - y(value)}" rx="3" fill="${color}"><title>${label}</title></rect>${value === 0 ? `<circle cx="${x(index)}" cy="${y(0)}" r="3" fill="${color}"><title>${label}</title></circle>` : ''}`;
    }).join('');
    return `<article class="chart-card" style="--series:${color}">
      <div class="chart-heading"><div><div class="eyebrow">WBR · COMPLETED UTC WEEKS</div><h3>${title}</h3><p>${key === 'identities' ? `Globally distinct identities observed since ${startLabel}` : 'Successful non-batch requests in each separate week'}</p></div></div>
      <div class="chart-readout"><strong>${value(latest[key])}</strong><span>week ending ${dateLabel(endDay(latest))}</span></div>
      <svg class="wbr-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="wbr-${key}-title" aria-describedby="wbr-${key}-desc">
        <title id="wbr-${key}-title">${title}: ${value(latest[key])} for the latest displayed week</title>
        <desc id="wbr-${key}-desc">${key === 'identities' ? 'Cumulative distinct identities, not summed weekly detections.' : 'Independent weekly successful-call totals, not daily or cumulative bars.'} Missing values are gaps, never zeros. Exact values and availability reasons are in the weekly table.</desc>
        ${Array.from({ length: 5 }, (_, index) => {
          const tick = max * index / 4;
          return `<line x1="${left}" y1="${y(tick)}" x2="${width - right}" y2="${y(tick)}" class="grid-line"/>${hasValues ? `<text x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${compact.format(tick)}</text>` : ''}`;
        }).join('')}
        ${marks}${weeks.map((week, index) => `<text x="${x(index)}" y="${height - 10}" text-anchor="middle">${dateLabel(endDay(week))}</text>`).join('')}
      </svg><div class="chart-footer"><span><i class="legend-dot"></i>${key === 'identities' ? 'Accumulated observed identities' : 'Individual successful requests'}</span><span>Week ending · UTC</span></div>
    </article>`;
  };
  const metricCell = (metric: WeeklyMetric) => `${value(metric)}${metric.status === 'unavailable' ? `<small>${escapeHtml(metric.reason)}</small>` : ''}`;
  return `<section id="wbr" aria-labelledby="wbr-title">
    <div class="section-heading"><div><div class="eyebrow">WBR · ACCELERATE PROFITABLE BUSINESS GROWTH</div><h2 id="wbr-title">Weekly business review</h2><p>Accumulated Agent identities, %WoW growth and weekly Agent call volumes for three completed Monday–Sunday UTC weeks.</p></div></div>
    ${wbrError ? `<p class="wbr-status" role="alert">${escapeHtml(wbrError)} No WBR figures from that file are shown.</p>` : `<p class="wbr-status">${wbrSnapshot ? `${complete ? 'Verified historical snapshot' : 'Partial historical snapshot'} · Read ${escapeHtml(wbrSnapshot.asOf)}.` : 'Historical data required: no private WBR snapshot is loaded. Rolling seven-day detections and synthetic creations are not substitutes.'}</p>`}
    ${stale ? '<p class="wbr-status" role="status">Historical snapshot: the latest completed weeks are not loaded. Dates below remain those of the saved report, not the current reporting period.</p>' : ''}
    <div class="charts-grid">${chart('identities', 'Accumulated Agent identities', '#008778')}${chart('calls', 'Weekly Agent call volumes', '#5779bb')}</div>
    <div class="table-scroll"><table><caption>WBR metrics · exact observed counts where verified · UTC week boundaries</caption><thead><tr><th scope="col">Week (UTC, inclusive dates)</th><th scope="col">Accumulated Agent identities</th><th scope="col">%WoW identities</th><th scope="col">Successful Agent calls</th></tr></thead>
      <tbody>${weeks.map((week, index) => `<tr><th scope="row">${week.startTime.slice(0, 10)} – ${endDay(week)}</th><td>${metricCell(week.identities)}</td><td>${growth(week.identities, index ? weeks[index - 1].identities : baseline)}</td><td>${metricCell(week.calls)}</td></tr>`).join('')}</tbody></table></div>
    <p class="trend-note wbr-note">Identity observation starts ${startLabel}. Count each identity once across organizations and detection sources through each week-end; never sum weekly distinct counts. This is observed accumulation, not lifetime inventory, creations or WAU. ${wbrSnapshot ? 'Coverage: configured source groups, not a guarantee of complete or worldwide telemetry.' : 'Historical source coverage has not been verified.'}</p>
    <p class="trend-note wbr-note">${Date.parse(identityStart) === Date.parse(weeks[0].startTime)
      && baseline.status === 'verified' && baseline.value === 0
      ? 'Observation begins with the first reporting week. Its zero baseline represents an empty observation interval, not a claim that no Agent identities existed earlier. First-week %WoW is N/A.'
      : `First-row %WoW needs the preceding week-end baseline (${daysBefore(weeks[0].startTime.slice(0, 10), 1)}): ${metricCell(baseline)}.`} Missing current or preceding totals mean unavailable growth; a verified zero denominator means N/A, not 0%.</p>
    <p class="trend-note wbr-note">Uses the same calculation as <a href="#call-volume">Weekly Agent call volume</a>, evaluated separately for each completed UTC week. Calls match the same-week detected cohort by organization and Agent object ID: HTTP 2xx except 202, error code 0, qualifying Dataverse API/SDK routes, no batch, ExecuteMultiple or ExecuteTransaction. Deduplicate organization/request IDs. Unavailable history is never a measured zero. These weeks are independent of the creation range and the rolling detection report. This view does not send email or update the WBR document.</p>
  </section>`;
}

function render(): void {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const previousDemo = document.querySelector<HTMLDetailsElement>('#sample-creation-demo');
  if (previousDemo) sampleTrendsOpen = previousDemo.open;
  const showProductionOverview = productionDetections || Boolean(detectionError);
  const hasProduction = productionDetections || Boolean(wbrSnapshot);
  const showSampleDemo = showProductionOverview || Boolean(wbrSnapshot) || Boolean(wbrError);
  const totals = data.totals;
  const coverage = totals.organizations ? Math.round((totals.organizations - totals.unmappedOrganizations) / totals.organizations * 100) : 0;
  const productionViews = ['Agents per organization', ...(tenantDetections ? ['Agents per tenant'] : []), ...(observedWau ? ['observed WAU'] : []), ...(callVolume ? ['weekly call volume'] : []), ...(callVolume?.byTenant ? ['tenant origins'] : [])];
  const productionDescription = productionViews.length === 1 ? 'Only Agents per organization uses' : `${productionViews.slice(0, -1).join(', ')} and ${productionViews.at(-1)} use`;
  root.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#main" aria-label="Dataverse security home"><span class="brand-mark">${icon('shield')}</span><span>dataverse<span class="brand-sub">SECURITY INTELLIGENCE</span></span></a>
      <div class="workspace-label"><span class="workspace-icon">D</span><div>Security workspace<small>${hasProduction ? 'Mixed data sources' : 'Sample environment'}</small></div><span class="status-dot"></span></div>
      <div class="nav-label">WORKSPACE</div>
      <nav aria-label="Dashboard navigation"><a class="nav-item" href="#main">${icon('grid')} Overview</a><a class="nav-item active" href="${showProductionOverview ? '#production-overview' : wbrSnapshot ? '#wbr' : '#trends'}" aria-current="page">${icon('agent')} Agent users <span class="nav-count">01</span></a><a class="nav-item" href="#wbr" aria-label="Weekly business review">${icon('calendar')} Weekly WBR</a><button class="nav-item" data-methodology>${icon('info')} Metric definitions</button></nav>
      <div class="nav-label upcoming-label">ON THE HORIZON</div>
      <div class="upcoming">${icon('shield')} Security roles <span>Planned</span></div><div class="upcoming">${icon('layers')} Access insights <span>Planned</span></div>
      <div class="sidebar-bottom"><div class="sample-orb">${icon('layers')}</div><h3>${hasProduction ? 'Local production snapshot.' : 'A safe place to explore.'}</h3><p>${hasProduction ? 'Reports loaded locally.<br>Creation trends remain synthetic.' : 'Illustrative data. Real possibilities.<br>No connection to your tenant.'}</p><button class="sidebar-link" data-methodology>About this dashboard ${icon('arrow')}</button></div>
      <div class="sidebar-footer"><span class="avatar">DV</span><div>Dataverse security<small>${hasProduction ? 'Local snapshot edition' : 'Sample-data edition'}</small></div></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb">Workspace ${icon('chevron')} <span>Agent users</span></div><div class="topbar-right"><span class="sample-badge"><i></i> ${hasProduction ? 'MIXED DATA SOURCES' : 'SAMPLE DATA'}</span><span class="utc-label">All times UTC</span></div></header>
      <main id="main">
        <div class="page-heading"><div><div class="eyebrow">IDENTITY & ACCESS / AGENT USERS</div><h1>Agent users<span class="title-dot">.</span></h1><p>${showSampleDemo ? 'Production reports and observed activity. Synthetic creation examples are separate.' : 'Understand adoption. Follow creation trends. See the bigger picture.'}</p></div>${showSampleDemo ? '' : `<button class="button export-button" id="export">${icon('download')} Export CSV</button>`}</div>
        <div class="sample-banner">${icon('info')}<p><strong>${detectionError ? 'Production detection snapshot unavailable.' : productionDetections ? `Production ${callVolume ? 'activity' : `detection${observedWau ? ' and WAU' : ''}`} snapshot; synthetic creation trends.` : wbrSnapshot ? 'Production WBR snapshot; synthetic creation and detection examples.' : "You're exploring synthetic sample data."}</strong> ${detectionError ? 'No production detection counts are shown. WBR availability is reported independently below.' : productionDetections ? `${productionDescription} production results. No continuous refresh. Sample creation trends are in a separate collapsed demo, not the production overview.` : wbrSnapshot ? 'Verified WBR values are labeled separately. No continuous refresh; creation and detection examples remain synthetic.' : 'Creation trends and a separate detection view; not live usage or security posture.'}</p><button data-methodology>How it works ${icon('arrow')}</button></div>
        ${showProductionOverview ? productionOverview() : ''}${wbrSection()}
        ${showSampleDemo ? `<details id="sample-creation-demo" ${sampleTrendsOpen ? 'open' : ''}><summary>Synthetic creation demo · not production telemetry</summary><div class="daily-heading"><p>Illustrative creation data only. These figures do not reconcile with production detections. Changing this range does not change the production report.</p><button class="button" id="export">${icon('download')} Export sample CSV</button></div>` : ''}
        <section id="sample-creations" aria-label="Synthetic creation overview" data-mode="synthetic">
        <section class="range-toolbar" aria-label="Sample creation date range"><div><span class="section-kicker">SYNTHETIC CREATION OVERVIEW</span><span class="range-caption">${dateLabel(data.daily[0].day, true)} – ${dateLabel(source.asOf, true)}</span></div><label class="range-select">${icon('calendar')}<select id="range" aria-label="Trend date range"><option value="90" ${range === 90 ? 'selected' : ''}>90 days ago through today</option><option value="30" ${range === 30 ? 'selected' : ''}>30 days ago through today</option><option value="7" ${range === 7 ? 'selected' : ''}>7 days ago through today</option></select></label></section>
        <section class="kpi-grid" aria-label="Agent users in selected period; organizations and tenants accumulated through today">
          ${metrics.map(metric => `<article class="kpi"><div class="kpi-label">${metric.title}${icon(metric.icon)}</div><div class="kpi-value">${format.format(totals[metric.key])}</div><div class="kpi-note"><span class="mini-dot" style="background:${metric.color}"></span>Synthetic · ${metric.key === 'users' ? 'Distinct across selected period' : 'Available-history distinct to date'}</div></article>`).join('')}
          <article class="kpi coverage"><div class="kpi-label">Tenant mapping${icon('check')}</div><div class="kpi-value">${coverage}<span>%</span></div><div class="kpi-note">Synthetic · ${totals.unmappedOrganizations} of ${totals.organizations} organizations unmapped</div></article>
        </section>
        <section id="trends" aria-labelledby="trends-title"><div class="section-heading"><div><h2 id="trends-title">Creation trends</h2><p>Daily growth and accumulated adoption. One aligned timeline.</p></div><div class="inspect-control"><label for="inspect-day">Inspect day</label><input id="inspect-day" type="date" min="${data.daily[0].day}" max="${source.asOf}" value="${data.daily[selectedIndex].day}" /></div></div>
          <div class="charts-grid">${chartMetrics.map(chart).join('')}</div>
          <div class="trend-note">${icon('info')}<span>${data.daily.length} UTC calendar buckets, including today. New Agent users shows daily creations. Cumulative Agent users, organizations and tenants count distinct identities from all available sample history since ${dateLabel(source.historyStart, true)}, including before the selected range. Hover a chart or use its arrow keys to inspect.</span></div>
        </section>
        <section class="mapping-note"><span class="mapping-icon">${icon('layers')}</span><div><h3>Organizations aren't tenants.</h3><p>Multiple organizations can belong to one tenant. Tenant counts use organization-details mappings; ${totals.unmappedOrganizations} organization${totals.unmappedOrganizations === 1 ? '' : 's'} in the available history through today ${totals.unmappedOrganizations === 1 ? 'is' : 'are'} unmapped. These remain in accumulated organization counts and their in-range creations remain in user counts, but they add no tenant.</p></div><button class="text-button" data-methodology>View methodology ${icon('arrow')}</button></section>
        <section class="daily-section"><div class="daily-heading"><div><h2>Behind the trends</h2><p>Daily new users; accumulated distinct users, organizations and tenants.</p></div><button class="button" id="toggle-table" aria-expanded="${tableVisible}" aria-controls="daily-table">${tableVisible ? 'Hide' : 'Show'} daily data ${icon('grid')}</button></div><div id="daily-table" ${tableVisible ? '' : 'hidden'}><div class="table-scroll"><table><caption>Synthetic daily new users and accumulated distinct counts (UTC)</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">New Agent users (daily)</th><th scope="col">Agent users to date</th><th scope="col">Organizations to date</th><th scope="col">Mapped tenants to date</th></tr></thead><tbody>${[...data.daily].reverse().map(day => `<tr><th scope="row">${day.day}</th><td>${day.users}</td><td>${day.cumulativeUsers}</td><td>${day.organizations}</td><td>${day.tenants}</td></tr>`).join('')}</tbody></table></div></div></section>
        </section>${showSampleDemo ? '</details>' : ''}
        <section id="detections" aria-labelledby="detections-title">
          <div class="section-heading"><div><div class="eyebrow">WRR · SEPARATE DETECTION VIEW · ${productionDetections ? 'PRODUCTION SNAPSHOT' : 'SYNTHETIC'}</div><h2 id="detections-title">Agents per organization</h2><p>Past week (rolling 7 days / 168 hours) of Agent-user detections, independent of the creation trend range.</p></div></div>
          ${detectionError ? `<p role="alert">${escapeHtml(detectionError)} No detection counts are shown. Creation trends remain synthetic.</p>` : `
          <p class="range-caption">${detections.startTime} inclusive – ${detections.endTime} exclusive (UTC)</p>
          <p class="range-caption">${productionDetections ? 'Read-only production snapshot. Approximate HLL counts (accuracy 2). Configured source groups queried strictly; telemetry completeness and sovereign-cloud coverage are not established. Snapshot window is fixed; reload reads the latest local file, not production.' : 'Exact synthetic counts. No production snapshot configured.'}</p>
          <div class="kpi-grid">
            <article class="kpi"><div class="kpi-label">Detected Agent identities</div><div class="kpi-value">${format.format(detections.totals.agents)}</div><div class="kpi-note">Distinct across organizations and sources</div></article>
            <article class="kpi"><div class="kpi-label">Detected organizations</div><div class="kpi-value">${format.format(detections.totals.organizations)}</div><div class="kpi-note">With at least one qualifying detection</div></article>
            <article class="kpi"><div class="kpi-label">Authentication pairs</div><div class="kpi-value">${format.format(detections.totals.authenticationPairs)}</div><div class="kpi-note">Distinct organization / agent pairs</div></article>
            <article class="kpi"><div class="kpi-label">Provisioning pairs</div><div class="kpi-value">${format.format(detections.totals.provisioningPairs)}</div><div class="kpi-note">Distinct organization / agent pairs</div></article>
          </div>
          <div class="table-scroll"><table><caption>${productionDetections ? 'Production Agent-user detections per organization — approximate distinct counts' : 'Synthetic Agent-user detections per organization — exact distinct counts'}</caption><thead><tr><th scope="col">Organization ID</th><th scope="col">Distinct detected agents</th><th scope="col">Authentication detected</th><th scope="col">Provisioning detected</th></tr></thead><tbody>${detections.rows.slice(detectionPage * detectionPageSize, (detectionPage + 1) * detectionPageSize).map(row => `<tr><th scope="row">${escapeHtml(row.organizationId)}</th><td>${row.agents}</td><td>${row.authentication}</td><td>${row.provisioning}</td></tr>`).join('')}</tbody></table></div>
          ${detections.rows.length > detectionPageSize ? `<div class="section-heading"><span class="range-caption">Organizations ${format.format(detectionPage * detectionPageSize + 1)}–${format.format(Math.min((detectionPage + 1) * detectionPageSize, detections.rows.length))} of ${format.format(detections.rows.length)} · sorted by distinct agents</span><div><button class="button" id="detection-previous" ${detectionPage === 0 ? 'disabled' : ''}>Previous organizations</button> <button class="button" id="detection-next" ${(detectionPage + 1) * detectionPageSize >= detections.rows.length ? 'disabled' : ''}>Next organizations</button></div></div>` : ''}
          ${detections.rows.length ? '' : '<p>No qualifying detections returned for this snapshot window.</p>'}
          <p class="trend-note">An agent seen in both sources counts once within an organization. The same agent in two organizations counts once in each row, but once in the global identity total. Source columns overlap and must not be added. Detections do not establish creation, sign-ins, or current enabled inventory. ${productionDetections ? 'Global totals come from globally merged sketches, not sums of organization estimates.' : 'Exact synthetic counts are shown here; the supplied report approach uses approximate HLL counts.'}</p>`}
        </section>
        ${agentsPerTenant()}
        ${wauChart()}
        ${callVolumeChart()}
        ${tenantCallsChart()}
        <footer class="page-footer"><span>${icon('shield')} Dataverse security intelligence</span><span>${hasProduction ? 'Production snapshots · creation trends synthetic · no continuous refresh' : `Synthetic dataset · generated for ${source.asOf} UTC · no live connection`}</span></footer>
        <p id="day-announcement" class="sr-only" aria-live="polite"></p>
      </main>
    </div>
    <dialog id="methodology" aria-labelledby="method-title"><div class="dialog-heading"><span class="eyebrow">DATA & DEFINITIONS</span><button id="close-dialog" class="close-button" aria-label="Close methodology">×</button></div><h2 id="method-title">What these numbers mean</h2>
      <p>This dashboard has <strong>separate creation, detection and observed API activity views</strong>, not an inventory of enabled users, sign-ins, permissions, or risk. Creation trends always use synthetic data. Detection counts ${productionDetections ? 'use a locally loaded production snapshot and approximate HLL estimates' : 'are synthetic unless a valid private production snapshot is configured'}.</p>
      <h3>Agents per organization: past week for WRR</h3><p>This separate view uses qualifying authentication and provisioning detections, not creation correlations. Its rolling seven-day (168-hour) window ends ${productionDetections ? 'at the snapshot query timestamp' : 'at page-load time'}, includes the start timestamp and excludes the end timestamp. It is not the previous calendar week. IDs are normalized to lowercase and blank IDs excluded. Agents are deduplicated across the entire week and both sources within each organization, not summed from daily distincts. Source-specific counts overlap; organization rows cannot be summed to get globally distinct identities. This view does not change when the creation trend range changes. The sample uses exact sets; production snapshots merge accuracy-2 HLL sketches per organization across clusters and sources and yield approximate counts. Configured source groups are not a guarantee of complete telemetry or worldwide coverage. The exact table row count can differ from the approximate global organization estimate.</p>
      <h3>Agents per tenant: the same detection week</h3><p>The tenant view groups the same full detected cohort through organization-details mappings, not the successful-call subset. Union identities or merge compatible sketches across each tenant’s organizations and both sources before counting; do not add organization estimates. One identity in multiple tenants can count in each, so tenant counts cannot be added to reproduce the global identity total. Authentication and provisioning counts overlap. Mapped organization counts plus unmapped organizations cover all detected organization rows exactly. Unmapped identities remain visible and can overlap mapped tenants. Tenant names are optional display labels, never grouping keys. The current mapping read time does not establish historical ownership. This is seven-day detection, not lifetime accumulated inventory. Missing production tenant detections are unavailable, never inferred from successful calls or organization totals.</p>
      <h3>Agent users, specifically</h3><p>Dataverse Agent users are provisioned for AI agents with enterprise-managed Microsoft Entra agent identities. A human user, application user, parent agent identity, and agent's user account are distinct concepts. An Entra agent identity alone is not counted here.</p>
      <h3>From correlated events to daily and to-date counts</h3><p>A qualifying correlation needs an Agent user identification with a user and organization ID, a creation event, and an apply-user or force-sync operation. Correlations are resolved before date filtering and assigned to the earliest creation-event timestamp in UTC, including when detection happened on a different day.</p>
      <h3>Observed weekly active Agent users (WAU)</h3><p>WAU requires at least one successful non-batch request on qualifying Dataverse API/SDK routes during the same report window. HTTP 2xx except 202 and error code 0 are required. Batch requests, ExecuteMultiple and ExecuteTransaction are excluded until child-result semantics are verified. Callers are joined to the same-week detected Agent-user cohort by both organization and Entra user object ID, then counted distinctly across all organizations and days. Successful requests by callers outside that cohort are not classified as Agent activity. This is an observed subset, not a complete inventory-based WAU. The chart accumulates successful callers from the window start; the last point is that week's WAU, not a sum of daily distincts or a trend of independent rolling seven-day totals. No WAU snapshot means unavailable, never zero or a detection-based fallback.</p>
      <h3>Weekly Agent call volume</h3><p>Call volume uses the same successful non-batch eligibility, detected cohort and report week as WAU, but counts individual requests. Duplicate telemetry for the same organization/request ID is counted once, at its earliest completion time. Distinct requests by one Agent user count separately. Daily counts sum to the weekly total; these are not cumulative bars or historical weekly totals. The private adapter must provide a verified server-generated request ID. Missing IDs or IDs associated with conflicting caller identities reject the snapshot, rather than producing a partial volume. Missing call-volume data is unavailable, not zero or inferred from WAU. Counts are exact for observed request IDs, not a claim of complete telemetry.</p>
      <h3>WBR: three completed UTC weeks</h3><p>The WBR section has its own independent private snapshot. It counts exact distinct Agent identities observed since October 1, 2026 through each week-end, across organizations and detection sources, not sums of weekly distincts or lifetime inventory. %WoW compares consecutive cumulative totals; the first row requires a fourth week-end baseline. Missing current or prior values mean unavailable growth; a verified zero denominator means N/A. Calls use the same-week detected cohort and successful non-batch eligibility, but are independent calendar-week totals. Weeks run Monday 00:00 UTC inclusive to the following Monday 00:00 UTC exclusive. Missing history creates chart gaps, never zero-filled bars. Historical snapshots retain their actual dates and show a stale warning when newer completed weeks exist. Creation-range controls do not affect WBR. No email sending or WBR document editing is performed.</p>
      <h3>Which tenants calls come from</h3><p>Deduplicated successful requests are attributed to environment tenants by joining organization IDs to the latest available organization-details mappings. Multiple organizations can map to one tenant; duplicate mapping rows cannot multiply calls. Conflicting nonempty mappings reject the snapshot. Unmapped calls stay visible and in the weekly total. Tenant call volumes plus unmapped calls must equal weekly volume. Tenant names are optional display labels resolved by tenant ID from verified tenant metadata, never organization names or inferred legal customer names. Missing names are shown as Name unavailable without changing counts. IDs remain the attribution keys, not caller home tenants or geographic origins. The chart shows the top ten tenants plus Other and Unmapped where applicable; the paginated table retains every mapped tenant and its full ID. Mapping read time is shown; historical tenant ownership at call time is not established. Missing attribution is unavailable, never synthetic or inferred from caller identity.</p>
      <p><strong>New Agent users:</strong> distinct created user object IDs within each UTC date, with a selected-period distinct card. <strong>Cumulative Agent users:</strong> distinct created user object IDs across all available history through each date, deduplicated across organizations, correlations and dates. This is not a running sum of daily user counts. <strong>Organizations:</strong> accumulated distinct organization IDs on qualifying creations through the end of each date. <strong>Tenants:</strong> accumulated distinct tenant IDs resolved from those organizations through each date. Organization and tenant cards show these counts through today; they do not reset when the visible range changes. Repeated identities are counted once, never summed from daily distincts. Duplicate mappings don't multiply counts; conflicting mappings cause an explicit error. Missing mappings don't reduce user or organization counts.</p>
      <h3>Range & sample limitations</h3><p>The default starts 90 UTC dates before today and includes today: 91 daily buckets. Cumulative user, organization and tenant counts include all available history before the selected range, starting ${dateLabel(source.historyStart, true)} in this synthetic dataset. This is available-history accumulation, not a verified lifetime inventory or currently enabled population. A date without creations has zero new users and carries forward accumulated counts. Today is an illustrative sample, not a complete observed day. In a future live adapter, unavailable telemetry must be marked unknown, not assumed zero, and historical coverage must be reported explicitly.</p>
      <p>The application executes no production query and holds no production credentials. Detection snapshots are loaded through a read-only localhost endpoint from a private file outside the repository. Creation-event and organization-to-tenant contracts remain illustrative, not a verified production schema. Correlation completeness, telemetry retention and mapping freshness remain future work.</p>
      <h3>Microsoft references</h3><p><a href="https://learn.microsoft.com/en-us/entra/agent-id/agent-users" target="_blank" rel="noreferrer">Microsoft Entra agent's user account ${icon('arrow')}</a></p><p><a href="https://learn.microsoft.com/en-us/power-platform/release-plan/2026wave1/data-platform/create-dataverse-agent-users-entra-agent-identity" target="_blank" rel="noreferrer">Dataverse Agent users release plan ${icon('arrow')}</a><br><small>This release-plan page is archived and does not establish current availability.</small></p>
    </dialog>`;
  bindEvents();
}

function inspect(index: number, announce = false): void {
  selectedIndex = Math.max(0, Math.min(data.daily.length - 1, index));
  const day = data.daily[selectedIndex];
  document.querySelector<HTMLInputElement>('#inspect-day')!.value = day.day;
  for (const metric of chartMetrics) {
    document.querySelector(`[data-value="${metric.key}"]`)!.textContent = format.format(day[metric.key]);
    const svg = document.querySelector<SVGSVGElement>(`[data-metric="${metric.key}"]`)!;
    const max = Math.max(4, Math.ceil(Math.max(...data.daily.map(item => item[metric.key])) / 4) * 4);
    const x = 40 + selectedIndex / (data.daily.length - 1) * (svg.viewBox.baseVal.width - 56);
    const y = 190 - day[metric.key] / max * 176;
    const line = svg.querySelector('.selection-line')!;
    line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x));
    const dot = svg.querySelector('.selection-dot')!;
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y));
    svg.setAttribute('aria-label', `${metric.title}: ${day[metric.key]} ${metric.key === 'users' ? 'on' : 'accumulated distinctly through'} ${day.day} UTC. Synthetic. Use left and right arrow keys to inspect dates.`);
  }
  document.querySelectorAll('[data-chart-date]').forEach(element => {
    element.textContent = `${dateLabel(day.day)}${day.day === source.asOf ? ' · today' : ''}`;
  });
  if (announce) document.querySelector('#day-announcement')!.textContent =
    `${day.day} UTC: ${day.users} daily new Agent users, ${day.cumulativeUsers} accumulated distinct Agent users, ${day.organizations} accumulated distinct organizations, ${day.tenants} accumulated distinct mapped tenants. Synthetic data.`;
}

function downloadCsv(): void {
  const rows = data.daily.map((day: DailyMetric) => `${day.day},${day.users},${day.cumulativeUsers},${day.organizations},${day.tenants},synthetic`);
  const blob = new Blob(['date_utc,new_agent_users_daily,agent_users_distinct_to_date,organizations_distinct_to_date,mapped_tenants_distinct_to_date,data_mode\n' + rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `synthetic-agent-users-${data.daily[0].day}-to-${source.asOf}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function agentsPerTenant(): string {
  const heading = '<div class="section-heading"><div><div class="eyebrow">WRR · SAME DETECTION COHORT</div><h2 id="tenant-detections-title">Agents per tenant</h2><p>Distinct detected Agent identities across each tenant’s organizations over the same rolling seven-day window.</p></div></div>';
  if (detectionError) return `<section id="tenant-detections" aria-labelledby="tenant-detections-title">${heading}<p>No tenant detection counts are shown because the production snapshot could not be loaded.</p></section>`;
  if (!tenantDetections) return `<section id="tenant-detections" aria-labelledby="tenant-detections-title">${heading}<p>Tenant detections unavailable. The production snapshot does not contain a per-tenant identity aggregation. Organization counts and successful-call attribution cannot supply these distinct counts.</p></section>`;
  const { rows, unmapped } = tenantDetections;
  const first = tenantDetectionPage * detectionPageSize;
  const cells = (row: TenantDetectionCounts['unmapped']) =>
    `<td>${format.format(row.organizations)}</td><td>${format.format(row.agents)}</td><td>${format.format(row.authentication)}</td><td>${format.format(row.provisioning)}</td>`;
  return `<section id="tenant-detections" aria-labelledby="tenant-detections-title">
    ${heading}
    <p class="range-caption">${detections.startTime} inclusive – ${detections.endTime} exclusive (UTC)</p>
    <p class="range-caption">${productionDetections ? 'Production snapshot · approximate HLL counts (accuracy 2)' : 'Synthetic sample · exact distinct counts'} · ${format.format(rows.length)} mapped tenants · ${format.format(unmapped.organizations)} unmapped organizations${tenantDetectionAsOf ? ` · Organization-details mapping read ${escapeHtml(tenantDetectionAsOf)}` : ''}.</p>
    <div class="table-scroll"><table><caption>${productionDetections ? 'Production' : 'Synthetic'} Agent-user detections per tenant</caption>
      <thead><tr><th scope="col">Tenant name</th><th scope="col">Tenant ID</th><th scope="col">Detected organizations</th><th scope="col">Distinct detected agents</th><th scope="col">Authentication detected</th><th scope="col">Provisioning detected</th></tr></thead>
      <tbody>${rows.slice(first, first + detectionPageSize).map(row => `<tr><th scope="row" class="tenant-name">${escapeHtml(row.tenantName ?? 'Name unavailable')}</th><td class="tenant-id">${escapeHtml(row.tenantId)}</td>${cells(row)}</tr>`).join('')}</tbody>
      <tfoot><tr class="unmapped-tenant"><th scope="row">Unmapped organizations</th><td>Tenant unavailable</td>${cells(unmapped)}</tr></tfoot>
    </table></div>
    ${rows.length > detectionPageSize ? `<div class="section-heading"><span class="range-caption">Tenants ${format.format(first + 1)}–${format.format(Math.min(first + detectionPageSize, rows.length))} of ${format.format(rows.length)} · sorted by distinct agents</span><div><button class="button" id="tenant-detection-previous" ${tenantDetectionPage === 0 ? 'disabled' : ''}>Previous detection tenants</button> <button class="button" id="tenant-detection-next" ${first + detectionPageSize >= rows.length ? 'disabled' : ''}>Next detection tenants</button></div></div>` : ''}
    ${rows.length ? '' : '<p>No mapped tenants with qualifying detections returned for this snapshot window.</p>'}
    <p class="trend-note">An Agent in several organizations within one tenant counts once for that tenant, across days and both sources. Source columns overlap and must not be added. An identity can appear in more than one tenant or in both mapped and unmapped organizations: tenant estimates must not be summed to get the global identity total. Organization counts cover the full detected cohort, not just successful callers. Current organization-details mappings do not establish historical ownership. This is seven-day detection, not lifetime inventory, new creations or successful-call WAU.</p>
  </section>`;
}

function bindEvents(): void {
  bindTenantPagination();
  for (const [id, delta] of [['tenant-detection-previous', -1], ['tenant-detection-next', 1]] as const) {
    document.getElementById(id)?.addEventListener('click', () => {
      tenantDetectionPage = Math.max(0, Math.min(Math.ceil(tenantDetections!.rows.length / detectionPageSize) - 1, tenantDetectionPage + delta));
      render();
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button && !button.disabled) button.focus();
      else document.getElementById(delta === 1 ? 'tenant-detection-previous' : 'tenant-detection-next')?.focus();
    });
  }
  for (const [id, delta] of [['detection-previous', -1], ['detection-next', 1]] as const) {
    document.getElementById(id)?.addEventListener('click', () => {
      detectionPage = Math.max(0, Math.min(Math.ceil(detections.rows.length / detectionPageSize) - 1, detectionPage + delta));
      render();
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button && !button.disabled) button.focus();
      else document.getElementById(delta === 1 ? 'detection-previous' : 'detection-next')?.focus();
    });
  }
  document.querySelector<HTMLSelectElement>('#range')!.addEventListener('change', event => {
    range = Number((event.target as HTMLSelectElement).value);
    data = aggregateDaily(creations, source.organizationDetails, daysBefore(source.asOf, range), source.asOf);
    selectedIndex = data.daily.length - 1;
    render();
    document.querySelector<HTMLSelectElement>('#range')!.focus();
  });
  document.querySelector('#export')!.addEventListener('click', downloadCsv);
  document.querySelector('#toggle-table')!.addEventListener('click', () => {
    tableVisible = !tableVisible;
    document.querySelector<HTMLDivElement>('#daily-table')!.hidden = !tableVisible;
    const button = document.querySelector<HTMLButtonElement>('#toggle-table')!;
    button.setAttribute('aria-expanded', String(tableVisible));
    button.innerHTML = `${tableVisible ? 'Hide' : 'Show'} daily data ${icon('grid')}`;
  });
  document.querySelector<HTMLInputElement>('#inspect-day')!.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    const index = data.daily.findIndex(day => day.day === input.value);
    if (index >= 0) inspect(index, true);
    else input.value = data.daily[selectedIndex].day;
  });
  bindChartEvents();
  const dialog = document.querySelector<HTMLDialogElement>('#methodology')!;
  document.querySelectorAll('[data-methodology]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
  document.querySelector('#close-dialog')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}

function bindTenantPagination(): void {
  for (const [id, delta] of [['tenant-previous', -1], ['tenant-next', 1]] as const) {
    document.getElementById(id)?.addEventListener('click', () => {
      const rows = callVolume!.byTenant!.rows;
      tenantPage = Math.max(0, Math.min(Math.ceil(rows.length / detectionPageSize) - 1, tenantPage + delta));
      render();
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button && !button.disabled) button.focus();
      else document.getElementById(delta === 1 ? 'tenant-previous' : 'tenant-next')?.focus();
    });
  }
}

function bindChartEvents(): void {
  for (const svg of document.querySelectorAll<SVGSVGElement>('.trend-chart')) {
    svg.addEventListener('pointermove', event => {
      const rect = svg.getBoundingClientRect();
      const width = svg.viewBox.baseVal.width;
      const height = svg.viewBox.baseVal.height;
      const scale = Math.min(rect.width / width, rect.height / height);
      const horizontalInset = (rect.width - width * scale) / 2;
      inspect(Math.round(((event.clientX - rect.left - horizontalInset) / scale - 40) / (width - 56) * (data.daily.length - 1)));
    });
    svg.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        inspect(event.key === 'Home' ? 0 : event.key === 'End' ? data.daily.length - 1 : selectedIndex + (event.key === 'ArrowLeft' ? -1 : 1), true);
      }
    });
  }
}

async function loadDetectionSnapshot(): Promise<void> {
  try {
    const response = await fetch('/api/detection-snapshot', { cache: 'no-store' });
    if (response.status !== 204) {
      if (!response.ok) throw new Error('Production detection snapshot is unavailable or invalid.');
      const snapshot = parseProductionSnapshot(await response.json());
      detections = snapshot;
      observedWau = snapshot.wau;
      callVolume = snapshot.callVolume;
      tenantDetections = snapshot.agentsByTenant;
      tenantDetectionAsOf = snapshot.agentsByTenant?.asOf;
      productionDetections = true;
    }
  } catch (error) {
    console.error('Detection snapshot could not be loaded:', error);
    detectionError = 'Production detection snapshot could not be loaded.';
  }
}

async function loadWbrSnapshot(): Promise<void> {
  try {
    const response = await fetch('/api/wbr-snapshot', { cache: 'no-store' });
    if (response.status === 204) return;
    if (!response.ok) throw new Error('Weekly WBR snapshot is unavailable or invalid.');
    wbrSnapshot = parseWbrSnapshot(await response.json());
  } catch (error) {
    console.error('Weekly WBR snapshot could not be loaded:', error);
    wbrError = 'Weekly WBR snapshot is unavailable or invalid.';
  }
}

async function initialize(): Promise<void> {
  await Promise.all([loadDetectionSnapshot(), loadWbrSnapshot()]);
  render();
  window.matchMedia('(min-width: 851px)').addEventListener('change', () => {
    for (const [index, metric] of chartMetrics.entries()) {
      document.querySelector(`[data-metric="${metric.key}"]`)!.closest('.chart-card')!.outerHTML = chart(metric, index);
    }
    for (const [id, draw] of [['wau', wauChart], ['call-volume', callVolumeChart], ['call-tenants', tenantCallsChart]] as const) {
      const dataOpen = document.querySelector<HTMLDetailsElement>(`#${id} details`)?.open;
      document.getElementById(id)!.outerHTML = draw();
      const details = document.querySelector<HTMLDetailsElement>(`#${id} details`);
      if (details) details.open = Boolean(dataOpen);
    }
    bindTenantPagination();
    bindChartEvents();
  });
}

void initialize().catch(error => {
  console.error('Dashboard could not initialize:', error);
  document.querySelector('#app')!.textContent = 'Dashboard data could not be loaded. Check the browser console for details.';
});
