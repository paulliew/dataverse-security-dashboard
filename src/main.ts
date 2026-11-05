import './style.css';
import { aggregateDaily, correlateCreations, daysBefore } from './analytics.ts';
import type { DailyMetric } from './analytics.ts';
import { loadSampleData } from './sampleData.ts';
import { aggregateDetections } from './detections.ts';
import { parseProductionSnapshot } from './snapshot.ts';
import type { ObservedCallVolume, ObservedWau } from './snapshot.ts';

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
let productionDetections = false;
let detectionError = '';
let observedWau: ObservedWau | undefined;
let callVolume: ObservedCallVolume | undefined;
let detectionPage = 0;
const detectionPageSize = 100;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
let range = 90;
let data = aggregateDaily(creations, source.organizationDetails, daysBefore(source.asOf, range), source.asOf);
let selectedIndex = data.daily.length - 1;
let tableVisible = false;
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
    <div class="chart-heading"><div><div class="eyebrow">${metric.key === 'users' ? 'DAILY CREATIONS' : 'ACCUMULATED TO DATE'}</div><h2>${metric.title}</h2><p>${metric.description}</p></div>
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

function render(): void {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const totals = data.totals;
  const coverage = totals.organizations ? Math.round((totals.organizations - totals.unmappedOrganizations) / totals.organizations * 100) : 0;
  const productionViews = ['Agents per organization', ...(observedWau ? ['observed WAU'] : []), ...(callVolume ? ['weekly call volume'] : [])];
  root.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#main" aria-label="Dataverse security home"><span class="brand-mark">${icon('shield')}</span><span>dataverse<span class="brand-sub">SECURITY INTELLIGENCE</span></span></a>
      <div class="workspace-label"><span class="workspace-icon">D</span><div>Security workspace<small>${productionDetections ? 'Mixed data sources' : 'Sample environment'}</small></div><span class="status-dot"></span></div>
      <div class="nav-label">WORKSPACE</div>
      <nav aria-label="Dashboard navigation"><a class="nav-item" href="#main">${icon('grid')} Overview</a><a class="nav-item active" href="#trends" aria-current="page">${icon('agent')} Agent users <span class="nav-count">01</span></a><button class="nav-item" data-methodology>${icon('info')} Metric definitions</button></nav>
      <div class="nav-label upcoming-label">ON THE HORIZON</div>
      <div class="upcoming">${icon('shield')} Security roles <span>Planned</span></div><div class="upcoming">${icon('layers')} Access insights <span>Planned</span></div>
      <div class="sidebar-bottom"><div class="sample-orb">${icon('layers')}</div><h3>${productionDetections ? 'Local production snapshot.' : 'A safe place to explore.'}</h3><p>${productionDetections ? 'Detection results loaded locally.<br>Creation trends remain synthetic.' : 'Illustrative data. Real possibilities.<br>No connection to your tenant.'}</p><button class="sidebar-link" data-methodology>About this dashboard ${icon('arrow')}</button></div>
      <div class="sidebar-footer"><span class="avatar">DV</span><div>Dataverse security<small>${productionDetections ? 'Local snapshot edition' : 'Sample-data edition'}</small></div></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb">Workspace ${icon('chevron')} <span>Agent users</span></div><div class="topbar-right"><span class="sample-badge"><i></i> ${productionDetections ? 'MIXED DATA SOURCES' : 'SAMPLE DATA'}</span><span class="utc-label">All times UTC</span></div></header>
      <main id="main">
        <div class="page-heading"><div><div class="eyebrow">IDENTITY & ACCESS / AGENT USERS</div><h1>Agent users<span class="title-dot">.</span></h1><p>Understand adoption. Follow creation trends. See the bigger picture.</p></div><button class="button export-button" id="export">${icon('download')} Export CSV</button></div>
        <div class="sample-banner">${icon('info')}<p><strong>${productionDetections ? `Production ${callVolume ? 'activity' : `detection${observedWau ? ' and WAU' : ''}`} snapshot; synthetic creation trends.` : "You're exploring synthetic sample data."}</strong> ${productionDetections ? `${productionViews.length === 1 ? 'Only Agents per organization uses' : productionViews.join(' and ') + ' use'} production results. No continuous refresh.` : 'Creation trends and a separate detection view; not live usage or security posture.'}</p><button data-methodology>How it works ${icon('arrow')}</button></div>
        <section class="range-toolbar" aria-label="Date range"><div><span class="section-kicker">CREATION OVERVIEW</span><span class="range-caption">${dateLabel(data.daily[0].day, true)} – ${dateLabel(source.asOf, true)}</span></div><label class="range-select">${icon('calendar')}<select id="range" aria-label="Trend date range"><option value="90" ${range === 90 ? 'selected' : ''}>90 days ago through today</option><option value="30" ${range === 30 ? 'selected' : ''}>30 days ago through today</option><option value="7" ${range === 7 ? 'selected' : ''}>7 days ago through today</option></select></label></section>
        <section class="kpi-grid" aria-label="Agent users in selected period; organizations and tenants accumulated through today">
          ${metrics.map(metric => `<article class="kpi"><div class="kpi-label">${metric.title}${icon(metric.icon)}</div><div class="kpi-value">${format.format(totals[metric.key])}</div><div class="kpi-note"><span class="mini-dot" style="background:${metric.color}"></span>${metric.key === 'users' ? 'Distinct across selected period' : 'Available-history distinct to date'}</div></article>`).join('')}
          <article class="kpi coverage"><div class="kpi-label">Tenant mapping${icon('check')}</div><div class="kpi-value">${coverage}<span>%</span></div><div class="kpi-note">${totals.unmappedOrganizations} of ${totals.organizations} organizations unmapped</div></article>
        </section>
        <section id="trends" aria-labelledby="trends-title"><div class="section-heading"><div><h2 id="trends-title">Creation trends</h2><p>Daily growth and accumulated adoption. One aligned timeline.</p></div><div class="inspect-control"><label for="inspect-day">Inspect day</label><input id="inspect-day" type="date" min="${data.daily[0].day}" max="${source.asOf}" value="${data.daily[selectedIndex].day}" /></div></div>
          <div class="charts-grid">${chartMetrics.map(chart).join('')}</div>
          <div class="trend-note">${icon('info')}<span>${data.daily.length} UTC calendar buckets, including today. New Agent users shows daily creations. Cumulative Agent users, organizations and tenants count distinct identities from all available sample history since ${dateLabel(source.historyStart, true)}, including before the selected range. Hover a chart or use its arrow keys to inspect.</span></div>
        </section>
        <section class="mapping-note"><span class="mapping-icon">${icon('layers')}</span><div><h3>Organizations aren't tenants.</h3><p>Multiple organizations can belong to one tenant. Tenant counts use organization-details mappings; ${totals.unmappedOrganizations} organization${totals.unmappedOrganizations === 1 ? '' : 's'} in the available history through today ${totals.unmappedOrganizations === 1 ? 'is' : 'are'} unmapped. These remain in accumulated organization counts and their in-range creations remain in user counts, but they add no tenant.</p></div><button class="text-button" data-methodology>View methodology ${icon('arrow')}</button></section>
        <section class="daily-section"><div class="daily-heading"><div><h2>Behind the trends</h2><p>Daily new users; accumulated distinct users, organizations and tenants.</p></div><button class="button" id="toggle-table" aria-expanded="${tableVisible}" aria-controls="daily-table">${tableVisible ? 'Hide' : 'Show'} daily data ${icon('grid')}</button></div><div id="daily-table" ${tableVisible ? '' : 'hidden'}><div class="table-scroll"><table><caption>Synthetic daily new users and accumulated distinct counts (UTC)</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">New Agent users (daily)</th><th scope="col">Agent users to date</th><th scope="col">Organizations to date</th><th scope="col">Mapped tenants to date</th></tr></thead><tbody>${[...data.daily].reverse().map(day => `<tr><th scope="row">${day.day}</th><td>${day.users}</td><td>${day.cumulativeUsers}</td><td>${day.organizations}</td><td>${day.tenants}</td></tr>`).join('')}</tbody></table></div></div></section>
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
        ${wauChart()}
        ${callVolumeChart()}
        <footer class="page-footer"><span>${icon('shield')} Dataverse security intelligence</span><span>${productionDetections ? 'Production activity snapshot · creation trends synthetic · no continuous refresh' : `Synthetic dataset · generated for ${source.asOf} UTC · no live connection`}</span></footer>
        <p id="day-announcement" class="sr-only" aria-live="polite"></p>
      </main>
    </div>
    <dialog id="methodology" aria-labelledby="method-title"><div class="dialog-heading"><span class="eyebrow">DATA & DEFINITIONS</span><button id="close-dialog" class="close-button" aria-label="Close methodology">×</button></div><h2 id="method-title">What these numbers mean</h2>
      <p>This dashboard has <strong>separate creation, detection and observed API activity views</strong>, not an inventory of enabled users, sign-ins, permissions, or risk. Creation trends always use synthetic data. Detection counts ${productionDetections ? 'use a locally loaded production snapshot and approximate HLL estimates' : 'are synthetic unless a valid private production snapshot is configured'}.</p>
      <h3>Agents per organization: past week for WRR</h3><p>This separate view uses qualifying authentication and provisioning detections, not creation correlations. Its rolling seven-day (168-hour) window ends ${productionDetections ? 'at the snapshot query timestamp' : 'at page-load time'}, includes the start timestamp and excludes the end timestamp. It is not the previous calendar week. IDs are normalized to lowercase and blank IDs excluded. Agents are deduplicated across the entire week and both sources within each organization, not summed from daily distincts. Source-specific counts overlap; organization rows cannot be summed to get globally distinct identities. This view does not change when the creation trend range changes. The sample uses exact sets; production snapshots merge accuracy-2 HLL sketches per organization across clusters and sources and yield approximate counts. Configured source groups are not a guarantee of complete telemetry or worldwide coverage. The exact table row count can differ from the approximate global organization estimate.</p>
      <h3>Agent users, specifically</h3><p>Dataverse Agent users are provisioned for AI agents with enterprise-managed Microsoft Entra agent identities. A human user, application user, parent agent identity, and agent's user account are distinct concepts. An Entra agent identity alone is not counted here.</p>
      <h3>From correlated events to daily and to-date counts</h3><p>A qualifying correlation needs an Agent user identification with a user and organization ID, a creation event, and an apply-user or force-sync operation. Correlations are resolved before date filtering and assigned to the earliest creation-event timestamp in UTC, including when detection happened on a different day.</p>
      <h3>Observed weekly active Agent users (WAU)</h3><p>WAU requires at least one successful non-batch request on qualifying Dataverse API/SDK routes during the same report window. HTTP 2xx except 202 and error code 0 are required. Batch requests, ExecuteMultiple and ExecuteTransaction are excluded until child-result semantics are verified. Callers are joined to the same-week detected Agent-user cohort by both organization and Entra user object ID, then counted distinctly across all organizations and days. Successful requests by callers outside that cohort are not classified as Agent activity. This is an observed subset, not a complete inventory-based WAU. The chart accumulates successful callers from the window start; the last point is that week's WAU, not a sum of daily distincts or a trend of independent rolling seven-day totals. No WAU snapshot means unavailable, never zero or a detection-based fallback.</p>
      <h3>Weekly Agent call volume</h3><p>Call volume uses the same successful non-batch eligibility, detected cohort and report week as WAU, but counts individual requests. Duplicate telemetry for the same organization/request ID is counted once, at its earliest completion time. Distinct requests by one Agent user count separately. Daily counts sum to the weekly total; these are not cumulative bars or historical weekly totals. The private adapter must provide a verified server-generated request ID. Missing IDs or IDs associated with conflicting caller identities reject the snapshot, rather than producing a partial volume. Missing call-volume data is unavailable, not zero or inferred from WAU. Counts are exact for observed request IDs, not a claim of complete telemetry.</p>
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

function bindEvents(): void {
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

async function initialize(): Promise<void> {
  try {
    const response = await fetch('/api/detection-snapshot', { cache: 'no-store' });
    if (response.status !== 204) {
      if (!response.ok) throw new Error('Production detection snapshot is unavailable or invalid.');
      const snapshot = parseProductionSnapshot(await response.json());
      detections = snapshot;
      observedWau = snapshot.wau;
      callVolume = snapshot.callVolume;
      productionDetections = true;
    }
  } catch (error) {
    console.error('Detection snapshot could not be loaded:', error);
    detectionError = 'Production detection snapshot could not be loaded.';
  }
  render();
  window.matchMedia('(min-width: 851px)').addEventListener('change', () => {
    for (const [index, metric] of chartMetrics.entries()) {
      document.querySelector(`[data-metric="${metric.key}"]`)!.closest('.chart-card')!.outerHTML = chart(metric, index);
    }
    for (const [id, draw] of [['wau', wauChart], ['call-volume', callVolumeChart]] as const) {
      const dataOpen = document.querySelector<HTMLDetailsElement>(`#${id} details`)?.open;
      document.getElementById(id)!.outerHTML = draw();
      const details = document.querySelector<HTMLDetailsElement>(`#${id} details`);
      if (details) details.open = Boolean(dataOpen);
    }
    bindChartEvents();
  });
}

void initialize().catch(error => {
  console.error('Dashboard could not initialize:', error);
  document.querySelector('#app')!.textContent = 'Dashboard data could not be loaded. Check the browser console for details.';
});
