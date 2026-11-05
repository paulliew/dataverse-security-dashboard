import './style.css';
import { aggregateDaily, correlateCreations, daysBefore } from './analytics.ts';
import type { DailyMetric } from './analytics.ts';
import { loadSampleData } from './sampleData.ts';
import { aggregateDetections } from './detections.ts';

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
const detections = aggregateDetections(source.detections,
  new Date(Date.parse(source.detectionEndTime) - 86_400_000).toISOString(), source.detectionEndTime);
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

function render(): void {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const totals = data.totals;
  const coverage = totals.organizations ? Math.round((totals.organizations - totals.unmappedOrganizations) / totals.organizations * 100) : 0;
  root.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#main" aria-label="Dataverse security home"><span class="brand-mark">${icon('shield')}</span><span>dataverse<span class="brand-sub">SECURITY INTELLIGENCE</span></span></a>
      <div class="workspace-label"><span class="workspace-icon">D</span><div>Security workspace<small>Sample environment</small></div><span class="status-dot"></span></div>
      <div class="nav-label">WORKSPACE</div>
      <nav aria-label="Dashboard navigation"><a class="nav-item" href="#main">${icon('grid')} Overview</a><a class="nav-item active" href="#trends" aria-current="page">${icon('agent')} Agent users <span class="nav-count">01</span></a><button class="nav-item" data-methodology>${icon('info')} Metric definitions</button></nav>
      <div class="nav-label upcoming-label">ON THE HORIZON</div>
      <div class="upcoming">${icon('shield')} Security roles <span>Planned</span></div><div class="upcoming">${icon('layers')} Access insights <span>Planned</span></div>
      <div class="sidebar-bottom"><div class="sample-orb">${icon('layers')}</div><h3>A safe place to explore.</h3><p>Illustrative data. Real possibilities.<br>No connection to your tenant.</p><button class="sidebar-link" data-methodology>About this dashboard ${icon('arrow')}</button></div>
      <div class="sidebar-footer"><span class="avatar">DV</span><div>Dataverse security<small>Sample-data edition</small></div></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb">Workspace ${icon('chevron')} <span>Agent users</span></div><div class="topbar-right"><span class="sample-badge"><i></i> SAMPLE DATA</span><span class="utc-label">All times UTC</span></div></header>
      <main id="main">
        <div class="page-heading"><div><div class="eyebrow">IDENTITY & ACCESS / AGENT USERS</div><h1>Agent users<span class="title-dot">.</span></h1><p>Understand adoption. Follow creation trends. See the bigger picture.</p></div><button class="button export-button" id="export">${icon('download')} Export CSV</button></div>
        <div class="sample-banner">${icon('info')}<p><strong>You're exploring synthetic sample data.</strong> Creation trends and a separate detection view; not live usage or security posture.</p><button data-methodology>How it works ${icon('arrow')}</button></div>
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
          <div class="section-heading"><div><div class="eyebrow">SEPARATE DETECTION VIEW · SYNTHETIC</div><h2 id="detections-title">Agents per organization</h2><p>Last 24 hours of Agent-user detections, independent of the creation trend range.</p></div></div>
          <p class="range-caption">${detections.startTime} inclusive – ${detections.endTime} exclusive (UTC)</p>
          <div class="kpi-grid">
            <article class="kpi"><div class="kpi-label">Detected Agent identities</div><div class="kpi-value">${format.format(detections.totals.agents)}</div><div class="kpi-note">Distinct across organizations and sources</div></article>
            <article class="kpi"><div class="kpi-label">Detected organizations</div><div class="kpi-value">${format.format(detections.totals.organizations)}</div><div class="kpi-note">With at least one qualifying detection</div></article>
            <article class="kpi"><div class="kpi-label">Authentication pairs</div><div class="kpi-value">${format.format(detections.totals.authenticationPairs)}</div><div class="kpi-note">Distinct organization / agent pairs</div></article>
            <article class="kpi"><div class="kpi-label">Provisioning pairs</div><div class="kpi-value">${format.format(detections.totals.provisioningPairs)}</div><div class="kpi-note">Distinct organization / agent pairs</div></article>
          </div>
          <div class="table-scroll"><table><caption>Synthetic Agent-user detections per organization — exact distinct counts</caption><thead><tr><th scope="col">Organization ID</th><th scope="col">Distinct detected agents</th><th scope="col">Authentication detected</th><th scope="col">Provisioning detected</th></tr></thead><tbody>${detections.rows.map(row => `<tr><th scope="row">${escapeHtml(row.organizationId)}</th><td>${row.agents}</td><td>${row.authentication}</td><td>${row.provisioning}</td></tr>`).join('')}</tbody></table></div>
          <p class="trend-note">An agent seen in both sources counts once within an organization. The same agent in two organizations counts once in each row, but once in the global identity total. Source columns overlap and must not be added. Detections do not establish creation, sign-ins, or current enabled inventory. Exact synthetic counts are shown here; the supplied report approach uses approximate HLL counts.</p>
        </section>
        <footer class="page-footer"><span>${icon('shield')} Dataverse security intelligence</span><span>Synthetic dataset · generated for ${source.asOf} UTC · no live connection</span></footer>
        <p id="day-announcement" class="sr-only" aria-live="polite"></p>
      </main>
    </div>
    <dialog id="methodology" aria-labelledby="method-title"><div class="dialog-heading"><span class="eyebrow">DATA & DEFINITIONS</span><button id="close-dialog" class="close-button" aria-label="Close methodology">×</button></div><h2 id="method-title">What these numbers mean</h2>
      <p>This is a <strong>synthetic dashboard with separate creation and detection views</strong>, not an inventory of enabled users, API activity, sign-ins, permissions, or risk.</p>
      <h3>Agents per organization: last 24 hours</h3><p>This separate view uses qualifying authentication and provisioning detections, not creation correlations. Its fixed window ends at page-load time, includes the start timestamp and excludes the end timestamp. IDs are normalized to lowercase and blank IDs excluded. Agents are deduplicated across sources within each organization. Source-specific counts overlap; organization rows cannot be summed to get globally distinct identities. This view does not change when the creation trend range changes. The sample uses exact sets; the sanitized query template merges accuracy-2 HLL sketches per organization across clusters and sources and yields approximate counts. No production query or source coverage has been validated by this sample view.</p>
      <h3>Agent users, specifically</h3><p>Dataverse Agent users are provisioned for AI agents with enterprise-managed Microsoft Entra agent identities. A human user, application user, parent agent identity, and agent's user account are distinct concepts. An Entra agent identity alone is not counted here.</p>
      <h3>From correlated events to daily and to-date counts</h3><p>A qualifying correlation needs an Agent user identification with a user and organization ID, a creation event, and an apply-user or force-sync operation. Correlations are resolved before date filtering and assigned to the earliest creation-event timestamp in UTC, including when detection happened on a different day.</p>
      <p><strong>New Agent users:</strong> distinct created user object IDs within each UTC date, with a selected-period distinct card. <strong>Cumulative Agent users:</strong> distinct created user object IDs across all available history through each date, deduplicated across organizations, correlations and dates. This is not a running sum of daily user counts. <strong>Organizations:</strong> accumulated distinct organization IDs on qualifying creations through the end of each date. <strong>Tenants:</strong> accumulated distinct tenant IDs resolved from those organizations through each date. Organization and tenant cards show these counts through today; they do not reset when the visible range changes. Repeated identities are counted once, never summed from daily distincts. Duplicate mappings don't multiply counts; conflicting mappings cause an explicit error. Missing mappings don't reduce user or organization counts.</p>
      <h3>Range & sample limitations</h3><p>The default starts 90 UTC dates before today and includes today: 91 daily buckets. Cumulative user, organization and tenant counts include all available history before the selected range, starting ${dateLabel(source.historyStart, true)} in this synthetic dataset. This is available-history accumulation, not a verified lifetime inventory or currently enabled population. A date without creations has zero new users and carries forward accumulated counts. Today is an illustrative sample, not a complete observed day. In a future live adapter, unavailable telemetry must be marked unknown, not assumed zero, and historical coverage must be reported explicitly.</p>
      <p>No production query is executed. The normalized source and organization-to-tenant contract are illustrative, not a verified production schema. Live access, correlation completeness, telemetry retention, mapping freshness, and source validation remain future work.</p>
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

try {
  render();
  window.matchMedia('(min-width: 851px)').addEventListener('change', () => {
    for (const [index, metric] of chartMetrics.entries()) {
      document.querySelector(`[data-metric="${metric.key}"]`)!.closest('.chart-card')!.outerHTML = chart(metric, index);
    }
    bindChartEvents();
  });
} catch (error) {
  console.error('Dashboard could not initialize:', error);
  document.querySelector('#app')!.textContent = 'Dashboard data could not be loaded. Check the browser console for details.';
}
