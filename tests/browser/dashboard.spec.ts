import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { wbrFixture } from '../fixtures/wbr.ts';

async function selectSampleRange(page: Page, value: string): Promise<void> {
  const demo = page.locator('#sample-creation-demo');
  if (await demo.count() && await demo.getAttribute('open') === null) await demo.locator('summary').click();
  await page.getByLabel('Trend date range').selectOption(value);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/detection-snapshot', route => route.fulfill({ status: 204 }));
  await page.route('**/api/wbr-snapshot', route => route.fulfill({ status: 204 }));
});

test('WBR shows three completed UTC weeks with unavailable history rather than sample or rolling counts', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-11T20:00:00Z'));
  await page.goto('/#wbr');
  const wbr = page.locator('#wbr');
  await expect(wbr.getByRole('heading', { name: 'Weekly business review' })).toBeVisible();
  await expect(wbr.getByRole('link', { name: 'Weekly Agent call volume', exact: true })).toHaveAttribute('href', '#call-volume');
  await expect(wbr).toContainText('evaluated separately for each completed UTC week');
  await expect(wbr.locator('tbody th')).toHaveText([
    '2026-10-19 – 2026-10-25', '2026-10-26 – 2026-11-01', '2026-11-02 – 2026-11-08',
  ]);
  await expect(wbr.locator('.chart-readout strong')).toHaveText(['Unavailable', 'Unavailable']);
  await expect(wbr.locator('svg circle, svg rect, svg polyline')).toHaveCount(0);
  await expect(wbr).toContainText('October 19, 2026');
  const rows = await wbr.locator('tbody tr').allTextContents();
  await selectSampleRange(page, '7');
  await expect(wbr.locator('tbody tr')).toHaveText(rows);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('verified WBR history renders independent weekly charts and correct WoW including measured zero calls', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-11T20:00:00Z'));
  await page.route('**/api/wbr-snapshot', route => route.fulfill({ json: wbrFixture() }));
  await page.goto('/#wbr');
  const wbr = page.locator('#wbr');
  await expect(page.getByText('Production WBR snapshot; synthetic creation and detection examples.')).toBeVisible();
  await expect(wbr.locator('.chart-readout strong')).toHaveText(['30', '0']);
  await expect(wbr.locator('tbody tr').first().locator('td')).toHaveText(['20', '+100.0%', '12']);
  await expect(wbr.locator('tbody tr').nth(1).locator('td')).toHaveText(['30', '+50.0%', '25']);
  await expect(wbr.locator('tbody tr').last().locator('td')).toHaveText(['30', '0.0%', '0']);
  await expect(wbr.locator('svg').first().locator('circle')).toHaveCount(3);
  await expect(wbr.locator('svg').last().locator('rect')).toHaveCount(3);
  await expect(wbr.getByRole('img').first()).toHaveAccessibleName(/Accumulated Agent identities: 30/);
  await expect(wbr).toContainText('Globally distinct identities observed since October 1, 2026');
  await expect(wbr).toContainText('Identity observation starts October 1, 2026');
  await expect(page.locator('#sample-creation-demo')).toHaveJSProperty('open', false);
  await selectSampleRange(page, '30');
  await expect(wbr.locator('.chart-readout strong')).toHaveText(['30', '0']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('WBR labels an approved later observation start and does not invent first-week growth', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-11T20:00:00Z'));
  const fixture = wbrFixture();
  await page.route('**/api/wbr-snapshot', route => route.fulfill({ json: {
    ...fixture, observationStart: '2026-10-19T00:00:00Z',
    baseline: { ...fixture.baseline, identities: { status: 'verified', value: 0 } },
  } }));
  await page.goto('/#wbr');
  const wbr = page.locator('#wbr');
  await expect(wbr).toContainText('Verified historical snapshot');
  await expect(wbr).toContainText('Globally distinct identities observed since October 19, 2026');
  await expect(wbr).toContainText('Identity observation starts October 19, 2026');
  await expect(wbr).toContainText('not a claim that no Agent identities existed earlier');
  await expect(wbr).not.toContainText('October 1, 2026');
  await expect(wbr.locator('tbody tr').first().locator('td')).toHaveText(['20', 'N/A (zero baseline; +20 identities)', '12']);
  await expect(wbr.locator('tbody tr').nth(1).locator('td')).toHaveText(['30', '+50.0%', '25']);
  await expect(wbr.locator('svg').first().locator('circle')).toHaveCount(3);
  await expect(wbr.locator('svg').first().locator('line[stroke]')).toHaveCount(2);
});

test('partial WBR history leaves chart gaps and preserves calls, escapes reasons and handles zero baselines', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-11T20:00:00Z'));
  const fixture = wbrFixture();
  await page.route('**/api/wbr-snapshot', route => route.fulfill({ json: {
    ...fixture,
    baseline: { ...fixture.baseline, identities: { status: 'verified', value: 0 } },
    weeks: fixture.weeks.map((week, index) => ({ ...week,
      identities: index === 1 ? { status: 'unavailable', reason: '<img src=x onerror=alert(1)> & missing history' } : week.identities,
    })),
  } }));
  await page.goto('/#wbr');
  const wbr = page.locator('#wbr');
  await expect(wbr).toContainText('Partial historical snapshot');
  await expect(wbr.locator('tbody tr').first()).toContainText('N/A (zero baseline; +20 identities)');
  await expect(wbr.locator('tbody tr').last().locator('td').nth(1)).toHaveText('Unavailable');
  await expect(wbr.locator('svg').first().locator('circle')).toHaveCount(2);
  await expect(wbr.locator('svg').first().locator('line[stroke]')).toHaveCount(0);
  await expect(wbr.locator('tbody tr').nth(1).locator('td').last()).toHaveText('25');
  await expect(wbr).toContainText('<img src=x onerror=alert(1)> & missing history');
  await expect(wbr.locator('img')).toHaveCount(0);
});

test('invalid WBR data does not suppress production detections; stale WBR snapshots keep their real dates', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-18T20:00:00Z'));
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-11-04T18:00:00Z', endTime: '2026-11-11T18:00:00Z', rowCount: 0, rows: [],
    totals: { agents: 0, organizations: 0, authenticationPairs: 0, provisioningPairs: 0 },
  } }));
  await page.route('**/api/wbr-snapshot', route => route.fulfill({ json: {} }));
  await page.goto('/#wbr');
  await expect(page.locator('#wbr [role="alert"]')).toContainText('Weekly WBR snapshot is unavailable or invalid');
  await expect(page.locator('#production-overview .kpi-value').first()).toHaveText('0');
  await page.route('**/api/wbr-snapshot', route => route.fulfill({ json: wbrFixture() }));
  await page.reload();
  await expect(page.locator('#wbr [role="status"]')).toContainText('latest completed weeks are not loaded');
  await expect(page.locator('#wbr tbody th').last()).toHaveText('2026-11-02 – 2026-11-08');
  await expect(page.locator('#wbr .chart-readout strong')).toHaveText(['30', '0']);
  await page.route('**/api/detection-snapshot', route => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(page.locator('#wbr .chart-readout strong')).toHaveText(['30', '0']);
  await expect(page.locator('#detections [role="alert"]')).toContainText('Production detection snapshot could not be loaded');
});

test('default 90-day synthetic trends, inspection, range, CSV and methodology work', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-23T18:19:58Z') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agent users.', exact: true })).toBeVisible();
  await expect(page.getByText("You're exploring synthetic sample data.")).toBeVisible();
  await expect(page.locator('#production-overview')).toHaveCount(0);
  await expect(page.locator('.trend-chart')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Cumulative Agent users', exact: true })).toBeVisible();
  await expect(page.getByText('July 25, 2026 – October 23, 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Show daily data' }).click();
  await expect(page.locator('#daily-table tbody tr')).toHaveCount(91);
  await expect(page.getByRole('columnheader', { name: 'Organizations to date', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Mapped tenants to date', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Agent users to date', exact: true })).toBeVisible();
  await expect(page.locator('.daily-tag')).toHaveText(['daily distinct', 'distinct to date', 'distinct to date', 'distinct to date']);
  const cumulativeReadout = await page.locator('[data-value="cumulativeUsers"]').innerText();
  const organizationCard = await page.locator('.kpi-value').nth(1).innerText();
  const tenantCard = await page.locator('.kpi-value').nth(2).innerText();
  const latestCounts = await page.locator('#daily-table tbody tr').first().locator('td').allTextContents();
  await page.getByLabel('Inspect day').fill('2026-10-22');
  await page.getByLabel('Inspect day').dispatchEvent('change');
  await expect(page.locator('[data-chart-date]').first()).toHaveText('Oct 22');
  await page.locator('[data-metric="cumulativeUsers"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Inspect day')).toHaveValue('2026-10-21');
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Inspect day')).toHaveValue('2026-07-25');
  const oldestCounts = await page.locator('#daily-table tbody tr').last().locator('td').allTextContents();
  await expect(page.locator('[data-value="cumulativeUsers"]')).toHaveText(Number(oldestCounts[1]).toLocaleString('en-US'));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('synthetic-agent-users-2026-07-25-to-2026-10-23.csv');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv.trim().split('\n')).toHaveLength(92);
  expect(csv).toContain('2026-07-25,');
  expect(csv).toContain(',synthetic');
  expect(csv.split('\n')[0]).toBe('date_utc,new_agent_users_daily,agent_users_distinct_to_date,organizations_distinct_to_date,mapped_tenants_distinct_to_date,data_mode');
  const csvRows = csv.trim().split('\n').slice(1).map(row => row.split(','));
  for (let index = 1; index < csvRows.length; index++) {
    expect(Number(csvRows[index][2])).toBeGreaterThanOrEqual(Number(csvRows[index - 1][2]));
    expect(Number(csvRows[index][3])).toBeGreaterThanOrEqual(Number(csvRows[index - 1][3]));
    expect(Number(csvRows[index][4])).toBeGreaterThanOrEqual(Number(csvRows[index - 1][4]));
  }
  expect(csvRows.at(-1)!.slice(1, 5)).toEqual(latestCounts);
  await selectSampleRange(page, '7');
  await expect(page.locator('#daily-table tbody tr')).toHaveCount(8);
  await expect(page.locator('.kpi-value').nth(1)).toHaveText(organizationCard);
  await expect(page.locator('.kpi-value').nth(2)).toHaveText(tenantCard);
  await expect(page.locator('[data-value="cumulativeUsers"]')).toHaveText(cumulativeReadout);
  expect(await page.locator('#daily-table tbody tr').first().locator('td').allTextContents()).toEqual(latestCounts);
  const firstVisible = csvRows.find(row => row[0] === '2026-10-16')!;
  expect(await page.locator('#daily-table tbody tr').last().locator('td').allTextContents()).toEqual(firstVisible.slice(1, 5));
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator('.trend-chart').first()).toHaveAttribute('viewBox', '0 0 450 222');
  await expect(page.locator('[data-metric="cumulativeUsers"]')).toHaveAttribute('viewBox', '0 0 450 222');
  await page.locator('[data-metric="cumulativeUsers"]').focus();
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Inspect day')).toHaveValue('2026-10-16');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.trend-chart').first()).toHaveAttribute('viewBox', '0 0 900 222');
  await expect(page.locator('[data-metric="cumulativeUsers"]')).toHaveAttribute('viewBox', '0 0 900 222');
  await page.getByRole('button', { name: 'View methodology' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent users, specifically' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('mobile layout fits the viewport and exposes daily counts accessibly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await page.getByRole('button', { name: 'Show daily data' }).click();
  await expect(page.locator('#daily-table table')).toBeVisible();
  await expect(page.locator('[data-metric="cumulativeUsers"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'How it works' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close methodology' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('WRR detection view deduplicates per organization across the past week and keeps its window on range changes', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T17:00:00Z'));
  await page.goto('/');
  const view = page.locator('#detections');
  await expect(view.getByRole('heading', { name: 'Agents per organization' })).toBeVisible();
  await expect(view).toContainText('Past week (rolling 7 days / 168 hours)');
  await expect(view).toContainText('2026-10-29T17:00:00.000Z inclusive');
  await expect(view).toContainText('2026-11-05T17:00:00.000Z exclusive');
  await expect(view.locator('tbody tr')).toHaveCount(12);
  const rows = await view.locator('tbody tr').allTextContents();
  await expect(view.locator('tbody tr').first().locator('td')).toHaveText(['6', '6', '3']);
  await expect(view.locator('.kpi-value').first()).toHaveText('6');
  const cards = await view.locator('.kpi-value').allTextContents();
  const tenants = page.locator('#tenant-detections');
  await expect(tenants.getByRole('heading', { name: 'Agents per tenant' })).toBeVisible();
  await expect(tenants).toContainText('Synthetic sample');
  const tenantRows = await tenants.locator('tbody tr').allTextContents();
  await expect(tenants.locator('tfoot')).toContainText('Unmapped organizations');
  await selectSampleRange(page, '7');
  expect(await view.locator('tbody tr').allTextContents()).toEqual(rows);
  expect(await view.locator('.kpi-value').allTextContents()).toEqual(cards);
  expect(await tenants.locator('tbody tr').allTextContents()).toEqual(tenantRows);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(view.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('production snapshot labels only detections as production and preserves global estimates across range changes', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 2,
    totals: { agents: 2, organizations: 2, authenticationPairs: 2, provisioningPairs: 2 },
    rows: [
      { organizationId: 'fixture-a', agents: 2, authentication: 1, provisioning: 2 },
      { organizationId: 'fixture-b', agents: 1, authentication: 1, provisioning: 0 },
    ],
  } }));
  await page.goto('/');
  await expect(page.getByText('Production detection snapshot; synthetic creation trends.')).toBeVisible();
  await expect(page.locator('#production-overview .kpi-value')).toHaveText(['2', '2', 'Unavailable', 'Unavailable']);
  await expect(page.locator('#sample-creation-demo')).toHaveJSProperty('open', false);
  const view = page.locator('#detections');
  await expect(view).toContainText('PRODUCTION SNAPSHOT');
  await expect(view).toContainText('Approximate HLL counts');
  await expect(view.locator('.kpi-value').first()).toHaveText('2');
  await expect(view.locator('tbody tr')).toHaveCount(2);
  await selectSampleRange(page, '7');
  await expect(page.locator('#sample-creation-demo')).toHaveJSProperty('open', true);
  await expect(view.locator('.kpi-value').first()).toHaveText('2');
  await expect(page.locator('.trend-chart').first()).toHaveAccessibleName(/synthetic/);
  await expect(page.locator('#tenant-detections')).toContainText('Tenant detections unavailable');
  await expect(page.locator('#tenant-detections tbody tr')).toHaveCount(0);
});

test('production overview leads with real snapshot estimates and separates synthetic creation controls and exports', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 2,
    totals: { agents: 2, organizations: 3, authenticationPairs: 2, provisioningPairs: 2 },
    rows: [
      { organizationId: 'synthetic-fixture-a', agents: 2, authentication: 1, provisioning: 2 },
      { organizationId: 'synthetic-fixture-b', agents: 1, authentication: 1, provisioning: 0 },
    ],
    agentsByTenant: {
      mapping: 'organization-details', asOf: '2026-11-05T18:00:00Z', rowCount: 1,
      rows: [{ tenantId: 'synthetic-fixture-tenant', organizations: 1, agents: 2, authentication: 1, provisioning: 2 }],
      unmapped: { organizations: 1, agents: 1, authentication: 1, provisioning: 0 },
      conflictingOrganizationMappings: 0,
    },
  } }));
  await page.goto('/');
  const overview = page.locator('#production-overview');
  const demo = page.locator('#sample-creation-demo');
  await expect(overview.getByRole('heading', { name: 'Production overview' })).toBeVisible();
  await expect(overview.locator('.kpi-value')).toHaveText(['2', '3', '1', '1']);
  await expect(overview).toContainText('2 exact organization rows');
  await expect(overview).toContainText('Approximate HLL2');
  await expect(overview).toContainText('2026-10-29T17:00:00Z inclusive');
  await expect(overview).toContainText('Production creation history is not connected');
  await expect(page.locator('.kpi-value').first()).toHaveText('2');
  await expect(demo).toHaveJSProperty('open', false);
  await expect(page.getByLabel('Trend date range')).not.toBeVisible();
  await expect(page.locator('.trend-chart').first()).not.toBeVisible();
  await expect(page.locator('#export')).not.toBeVisible();
  await expect(page.locator('.page-heading #export')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Agent users 01' })).toHaveAttribute('href', '#production-overview');
  const summary = demo.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(demo).toHaveJSProperty('open', true);
  await expect(demo).toContainText('Illustrative creation data only');
  await expect(page.locator('#sample-creations .kpi-note')).toContainText(['Synthetic', 'Synthetic', 'Synthetic', 'Synthetic']);
  await selectSampleRange(page, '30');
  await expect(demo).toHaveJSProperty('open', true);
  await expect(overview.locator('.kpi-value')).toHaveText(['2', '3', '1', '1']);
  await expect(overview).toContainText('2026-11-05T17:00:00Z exclusive');
  const downloadPromise = page.waitForEvent('download');
  await demo.getByRole('button', { name: 'Export sample CSV' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('synthetic-agent-users-2026-10-06-to-2026-11-05.csv');
  await demo.locator('summary').click();
  await expect(demo).toHaveJSProperty('open', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overview).toBeVisible();
  await expect(demo).toHaveJSProperty('open', false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed or malformed production snapshots show an explicit error, not sample or zero detections', async ({ page }) => {
  await page.route('**/api/detection-snapshot', route => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('No detection counts are shown');
  await expect(page.locator('#detections .kpi-value')).toHaveCount(0);
  await expect(page.locator('#production-overview')).toContainText('Production overview unavailable');
  await expect(page.locator('#production-overview .kpi-value')).toHaveCount(0);
  await expect(page.locator('#sample-creation-demo')).toHaveJSProperty('open', false);
  await expect(page.locator('#tenant-detections tbody tr')).toHaveCount(0);
  await expect(page.locator('.trend-chart')).toHaveCount(4);
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: { dataMode: 'production' } }));
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#detections tbody tr')).toHaveCount(0);
});

test('production organization pagination retains all rows and handles the final partial page', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 101,
    totals: { agents: 1, organizations: 101, authenticationPairs: 101, provisioningPairs: 0 },
    rows: Array.from({ length: 101 }, (_, index) => ({
      organizationId: `fixture-${String(index).padStart(3, '0')}`, agents: 1, authentication: 1, provisioning: 0,
    })),
  } }));
  await page.goto('/');
  await expect(page.locator('#detections tbody tr')).toHaveCount(100);
  await expect(page.getByRole('button', { name: 'Previous organizations' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next organizations' }).click();
  await expect(page.locator('#detections tbody tr')).toHaveCount(1);
  await expect(page.locator('#detections tbody th')).toHaveText('fixture-100');
  await expect(page.getByRole('button', { name: 'Next organizations' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous organizations' })).toBeFocused();
  await page.getByRole('button', { name: 'Previous organizations' }).click();
  await expect(page.locator('#detections tbody tr')).toHaveCount(100);
  await expect(page.locator('#detections .kpi-value').first()).toHaveText('1');
});

test('tenant detections preserve distinct estimates, tenant names, unmapped coverage and all paginated rows', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  const longName = '\u6771\u4eac <img src=x onerror=alert(1)> ' + 'SyntheticLongTenantName'.repeat(12);
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 104,
    totals: { agents: 2, organizations: 104, authenticationPairs: 104, provisioningPairs: 3 },
    rows: Array.from({ length: 104 }, (_, index) => ({
      organizationId: `synthetic-org-${String(index).padStart(3, '0')}`,
      agents: index === 0 ? 2 : 1, authentication: 1, provisioning: index === 0 ? 2 : index === 1 ? 1 : 0,
    })),
    agentsByTenant: {
      mapping: 'organization-details', asOf: '2026-11-05T18:00:00Z', rowCount: 101,
      rows: Array.from({ length: 101 }, (_, index) => ({
        tenantId: `synthetic-tenant-${String(index).padStart(3, '0')}`,
        ...(index === 0 ? { tenantName: longName } : {}),
        organizations: index === 0 ? 2 : 1, agents: index === 0 ? 2 : 1,
        authentication: 1, provisioning: index === 0 ? 2 : 0,
      })),
      unmapped: { organizations: 2, agents: 1, authentication: 1, provisioning: 0 },
      conflictingOrganizationMappings: 0,
    },
  } }));
  await page.goto('/#tenant-detections');
  const view = page.locator('#tenant-detections');
  await expect(view).toContainText('Production snapshot');
  await expect(view).toContainText('101 mapped tenants');
  await expect(view).toContainText('2 unmapped organizations');
  await expect(view.locator('tbody tr')).toHaveCount(100);
  await expect(view.locator('tbody tr').first().locator('th')).toHaveText(longName);
  await expect(view.locator('tbody tr').first().locator('td')).toHaveText(['synthetic-tenant-000', '2', '2', '1', '2']);
  await expect(view.locator('tbody img')).toHaveCount(0);
  await expect(view.locator('tbody tr').nth(1).locator('th')).toHaveText('Name unavailable');
  await expect(view.locator('tfoot td')).toHaveText(['Tenant unavailable', '2', '1', '1', '0']);
  await expect(page.locator('#detections .kpi-value').first()).toHaveText('2');
  await selectSampleRange(page, '7');
  await expect(view.locator('tbody tr')).toHaveCount(100);
  await view.getByRole('button', { name: 'Next detection tenants' }).click();
  await expect(view.locator('tbody tr')).toHaveCount(1);
  await expect(view.locator('tbody .tenant-id')).toHaveText('synthetic-tenant-100');
  await expect(view.getByRole('button', { name: 'Previous detection tenants' })).toBeFocused();
  await expect(view.getByRole('button', { name: 'Next detection tenants' })).toBeDisabled();
  await view.getByRole('button', { name: 'Previous detection tenants' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(view.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('tenant detections distinguish verified zero, an entirely unmapped cohort and invalid attribution', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  const snapshot = {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 0,
    totals: { agents: 0, organizations: 0, authenticationPairs: 0, provisioningPairs: 0 },
    rows: [] as { organizationId: string; agents: number; authentication: number; provisioning: number }[],
    agentsByTenant: {
      mapping: 'organization-details', asOf: '2026-11-05T18:00:00Z', rowCount: 0, rows: [],
      unmapped: { organizations: 0, agents: 0, authentication: 0, provisioning: 0 },
      conflictingOrganizationMappings: 0,
    },
  };
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: snapshot }));
  await page.goto('/#tenant-detections');
  const view = page.locator('#tenant-detections');
  await expect(view).toContainText('0 mapped tenants');
  await expect(view).toContainText('0 unmapped organizations');
  await expect(view).not.toContainText('unavailable.');
  await expect(view.locator('tfoot td')).toHaveText(['Tenant unavailable', '0', '0', '0', '0']);
  snapshot.rowCount = 1;
  snapshot.rows = [{ organizationId: 'synthetic-unmapped', agents: 2, authentication: 1, provisioning: 2 }];
  snapshot.totals = { agents: 2, organizations: 1, authenticationPairs: 1, provisioningPairs: 2 };
  snapshot.agentsByTenant.unmapped = { organizations: 1, agents: 2, authentication: 1, provisioning: 2 };
  await page.reload();
  await expect(view).toContainText('1 unmapped organizations');
  await expect(view.locator('tfoot td')).toHaveText(['Tenant unavailable', '1', '2', '1', '2']);
  snapshot.agentsByTenant.conflictingOrganizationMappings = 1;
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('No detection counts are shown');
  await expect(view.locator('table')).toHaveCount(0);
  await expect(page.locator('#detections tbody tr')).toHaveCount(0);
});

test('observed WAU uses a separate production curve and accessible data without changing detection or creation metrics', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 1,
    totals: { agents: 3, organizations: 1, authenticationPairs: 3, provisioningPairs: 0 },
    rows: [{ organizationId: 'fixture-a', agents: 3, authentication: 3, provisioning: 0 }],
    wau: {
      scope: 'detected-cohort-nonbatch-success', countMethod: 'approximate-hll2', agents: 2,
      daily: Array.from({ length: 8 }, (_, index) => ({
        day: new Date(Date.UTC(2026, 9, 29 + index)).toISOString().slice(0, 10), agents: index < 3 ? 1 : 2,
      })),
    },
  } }));
  await page.goto('/');
  await expect(page.locator('#wau-value')).toHaveText('≈2');
  await expect(page.locator('.wau-chart')).toHaveAccessibleName('Observed WAU: approximately 2 Agent-user identities');
  await expect(page.locator('#wau')).toContainText('Same-week detected cohort only');
  await expect(page.locator('#wau')).toContainText('not a complete active-Agent inventory');
  await expect(page.locator('#detections .kpi-value').first()).toHaveText('3');
  await page.getByText('Show observed WAU data', { exact: true }).click();
  await expect(page.locator('#wau tbody tr')).toHaveCount(8);
  await expect(page.locator('#wau tbody tr').last().locator('td')).toHaveText('2');
  await selectSampleRange(page, '7');
  await expect(page.locator('#wau-value')).toHaveText('≈2');
  await expect(page.locator('.trend-chart')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.wau-chart')).toBeVisible();
  await expect(page.locator('.wau-chart')).toHaveAttribute('viewBox', '0 0 450 222');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('missing successful-call data is unavailable, not zero and not inferred from detections', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#wau')).toContainText('Unavailable: no verified successful-call snapshot loaded');
  await expect(page.locator('#wau-value')).toHaveCount(0);
  await expect(page.locator('.wau-chart')).toHaveCount(0);
  await expect(page.locator('#call-volume')).toContainText('Unavailable: no verified call-volume snapshot loaded');
  await expect(page.locator('#call-volume-value')).toHaveCount(0);
  await expect(page.locator('#call-tenants')).toContainText('Unavailable: no verified organization-to-tenant attribution loaded');
  await expect(page.locator('#call-tenant-count')).toHaveCount(0);
});

test('weekly call volume shows individual daily requests, a weekly total and accessible responsive data independently of WAU', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  const daily = Array.from({ length: 8 }, (_, index) => ({
    day: new Date(Date.UTC(2026, 9, 29 + index)).toISOString().slice(0, 10), calls: index === 0 ? 10 : index === 7 ? 6 : 0,
  }));
  const snapshot = {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 1,
    totals: { agents: 3, organizations: 1, authenticationPairs: 3, provisioningPairs: 0 },
    rows: [{ organizationId: 'fixture-a', agents: 3, authentication: 3, provisioning: 0 }],
    wau: { scope: 'detected-cohort-nonbatch-success', countMethod: 'approximate-hll2', agents: 2,
      daily: daily.map(row => ({ day: row.day, agents: row.calls === 6 ? 2 : 1 })) },
    callVolume: { scope: 'detected-cohort-nonbatch-success', countMethod: 'distinct-request-ids',
      calls: 16, missingRequestIds: 0, conflictingRequestIds: 0, daily },
  };
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: snapshot }));
  await page.goto('/');
  await expect(page.locator('#call-volume-value')).toHaveText('16');
  await expect(page.locator('#call-tenants')).toContainText('Caller home tenants and sample mappings are not used as substitutes');
  await expect(page.locator('.volume-chart')).toHaveAccessibleName('Weekly Agent call volume: 16 successful calls');
  await expect(page.locator('.volume-chart rect')).toHaveCount(8);
  await expect(page.locator('#wau-value')).toHaveText('≈2');
  await expect(page.locator('#call-volume')).toContainText('One identity making ten calls adds ten calls but only one to WAU');
  await page.getByText('Show weekly call volume data', { exact: true }).click();
  await expect(page.locator('#call-volume tbody tr')).toHaveCount(8);
  await expect(page.locator('#call-volume tbody tr').first().locator('td')).toHaveText('10');
  await expect(page.locator('#call-volume tbody tr').nth(1).locator('td')).toHaveText('0');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.volume-chart')).toHaveAttribute('viewBox', '0 0 450 222');
  await expect(page.locator('#call-volume details')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectSampleRange(page, '7');
  await expect(page.locator('#call-volume-value')).toHaveText('16');
  await expect(page.locator('#wau-value')).toHaveText('≈2');
  await expect(page.locator('.trend-chart')).toHaveCount(4);
  snapshot.callVolume.calls = 0;
  snapshot.callVolume.daily.forEach(row => { row.calls = 0; });
  snapshot.wau.agents = 0;
  snapshot.wau.daily.forEach(row => { row.agents = 0; });
  await page.reload();
  await expect(page.locator('#call-volume-value')).toHaveText('0');
  await expect(page.locator('.volume-chart')).toBeVisible();
});

test('tenant origins reconcile call totals, expose full IDs, include Other/unmapped and retain paginated rows after resize', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00Z'));
  const daily = Array.from({ length: 8 }, (_, index) => ({
    day: new Date(Date.UTC(2026, 9, 29 + index)).toISOString().slice(0, 10), calls: index === 0 ? 10 : index === 7 ? 6 : 0,
  }));
  const snapshot = {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime: '2026-10-29T17:00:00Z', endTime: '2026-11-05T17:00:00Z', rowCount: 4,
    totals: { agents: 3, organizations: 4, authenticationPairs: 5, provisioningPairs: 0 },
    rows: Array.from({ length: 4 }, (_, index) => ({
      organizationId: `fixture-org-${index}`, agents: index === 2 ? 2 : 1, authentication: index === 2 ? 2 : 1, provisioning: 0,
    })),
    wau: { scope: 'detected-cohort-nonbatch-success', countMethod: 'approximate-hll2', agents: 2,
      daily: daily.map(row => ({ day: row.day, agents: row.calls === 6 ? 2 : 1 })) },
    callVolume: { scope: 'detected-cohort-nonbatch-success', countMethod: 'distinct-request-ids',
      calls: 16, missingRequestIds: 0, conflictingRequestIds: 0, daily,
      byTenant: { mapping: 'organization-details', asOf: '2026-11-05T18:00:00Z', rowCount: 2,
        conflictingOrganizationMappings: 0, unmappedCalls: 2,
        rows: [{ tenantId: 'fixture-tenant-a', tenantName: 'Sample <North> & Partners', calls: 10 }, { tenantId: 'fixture-tenant-b', calls: 4 }] } },
  };
  await page.route('**/api/detection-snapshot', route => route.fulfill({ json: snapshot }));
  await page.goto('/');
  await expect(page.locator('#call-tenant-count')).toHaveText('2');
  await expect(page.locator('.tenant-chart')).toHaveAccessibleName('Successful Agent calls by environment tenant: 2 mapped tenants');
  await expect(page.locator('#unmapped-call-count')).toHaveText('2');
  await expect(page.locator('#call-tenants thead')).toContainText('Tenant name');
  await expect(page.locator('#call-tenants tbody tr').first().getByRole('rowheader')).toHaveText('Sample <North> & Partners');
  await expect(page.locator('#call-tenants tbody tr').nth(1).getByRole('rowheader')).toHaveText('Name unavailable');
  await expect(page.locator('#call-tenants tbody tr').first().getByRole('cell').first()).toHaveText('fixture-tenant-a');
  await expect(page.locator('#call-tenants tbody north')).toHaveCount(0);
  await expect(page.locator('#call-tenants tbody tr').first()).toContainText('fixture-tenant-a');
  await expect(page.locator('#call-tenants tbody tr').first()).toContainText('62.5%');
  await expect(page.locator('#call-volume-value')).toHaveText('16');
  await expect(page.locator('#wau-value')).toHaveText('≈2');
  await selectSampleRange(page, '7');
  await expect(page.locator('#call-tenant-count')).toHaveText('2');
  snapshot.callVolume.byTenant.rows = Array.from({ length: 121 }, (_, index) => ({
    tenantId: `fixture-tenant-${String(index).padStart(3, '0')}`, calls: 1,
    ...(index === 0 ? { tenantName: 'Sample tenant with a long display name '.repeat(12) } : {}),
  }));
  snapshot.callVolume.byTenant.rowCount = 121;
  snapshot.callVolume.byTenant.unmappedCalls = 1;
  snapshot.callVolume.calls = 122;
  snapshot.callVolume.daily.forEach((row, index) => { row.calls = index ? 0 : 122; });
  snapshot.wau.daily.forEach(row => { row.agents = 2; });
  snapshot.rowCount = 122;
  snapshot.rows = Array.from({ length: 122 }, (_, index) => ({
    organizationId: `fixture-org-${index}`, agents: index ? 1 : 2, authentication: index ? 1 : 2, provisioning: 0,
  }));
  snapshot.totals.organizations = 122;
  snapshot.totals.authenticationPairs = 123;
  await page.reload();
  await expect(page.locator('#call-tenant-count')).toHaveText('121');
  await expect(page.locator('.tenant-chart rect')).toHaveCount(12);
  await expect(page.locator('.tenant-chart')).toContainText('Other mapped tenants (111)');
  await expect(page.locator('#call-tenants tbody tr')).toHaveCount(101);
  await page.getByRole('button', { name: 'Next tenants', exact: true }).click();
  await expect(page.locator('#call-tenants tbody tr')).toHaveCount(22);
  await expect(page.locator('#call-tenants tbody tr').nth(20)).toContainText('fixture-tenant-120');
  await expect(page.locator('#call-tenants tbody tr').first().getByRole('rowheader')).toHaveText('Name unavailable');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.tenant-chart')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Previous tenants', exact: true }).click();
  await expect(page.locator('#call-tenants tbody tr')).toHaveCount(101);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  snapshot.callVolume.byTenant.rows = [];
  snapshot.callVolume.byTenant.rowCount = 0;
  snapshot.callVolume.byTenant.unmappedCalls = 122;
  await page.reload();
  await expect(page.locator('#call-tenant-count')).toHaveText('0');
  await expect(page.locator('#unmapped-call-count')).toHaveText('122');
  await expect(page.locator('#call-volume-value')).toHaveText('122');
  await expect(page.locator('#call-tenants tbody tr')).toHaveCount(1);
});
