import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/detection-snapshot', route => route.fulfill({ status: 204 }));
});

test('default 90-day synthetic trends, inspection, range, CSV and methodology work', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-23T18:19:58Z') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agent users.', exact: true })).toBeVisible();
  await expect(page.getByText("You're exploring synthetic sample data.")).toBeVisible();
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
  await page.getByLabel('Trend date range').selectOption('7');
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
  await page.getByLabel('Trend date range').selectOption('7');
  expect(await view.locator('tbody tr').allTextContents()).toEqual(rows);
  expect(await view.locator('.kpi-value').allTextContents()).toEqual(cards);
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
  const view = page.locator('#detections');
  await expect(view).toContainText('PRODUCTION SNAPSHOT');
  await expect(view).toContainText('Approximate HLL counts');
  await expect(view.locator('.kpi-value').first()).toHaveText('2');
  await expect(view.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Trend date range').selectOption('7');
  await expect(view.locator('.kpi-value').first()).toHaveText('2');
  await expect(page.locator('.trend-chart').first()).toHaveAccessibleName(/synthetic/);
});

test('failed or malformed production snapshots show an explicit error, not sample or zero detections', async ({ page }) => {
  await page.route('**/api/detection-snapshot', route => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('No detection counts are shown');
  await expect(page.locator('#detections .kpi-value')).toHaveCount(0);
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
  await page.getByLabel('Trend date range').selectOption('7');
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
  await page.getByLabel('Trend date range').selectOption('7');
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
