import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProductionSnapshot } from '../src/snapshot.ts';
import { snapshotMiddleware } from '../vite.config.ts';
import { daysBefore } from '../src/analytics.ts';

const fixture = () => ({
  version: 1, dataMode: 'production', countMethod: 'approximate-hll2',
  coverage: 'configured-source-groups', startTime: '2026-10-29T17:00:00.1234567Z', endTime: '2026-11-05T17:00:00.1234567Z',
  rowCount: 2,
  rows: [
    { organizationId: 'fixture-a', agents: 2, authentication: 1, provisioning: 2 },
    { organizationId: 'fixture-b', agents: 1, authentication: 1, provisioning: 0 },
  ],
  totals: { agents: 2, organizations: 2, authenticationPairs: 2, provisioningPairs: 2 },
});

test('production snapshot preserves globally merged estimates instead of summing per-organization counts', () => {
  const parsed = parseProductionSnapshot(fixture());
  assert.equal(parsed.totals.agents, 2);
  assert.equal(parsed.rows.reduce((sum, row) => sum + row.agents, 0), 3);
  assert.equal(parsed.countMethod, 'approximate-hll2');
});

const agentTenantsFixture = () => ({
  ...fixture(),
  agentsByTenant: {
    mapping: 'organization-details', asOf: '2026-11-05T18:00:00Z', rowCount: 1,
    rows: [{ tenantId: ' TENANT-A ', tenantName: ' Example tenant ', organizations: 2,
      agents: 2, authentication: 1, provisioning: 2 }],
    unmapped: { organizations: 0, agents: 0, authentication: 0, provisioning: 0 },
    conflictingOrganizationMappings: 0,
  },
});

test('tenant detection snapshots are optional and retain merged identities, names and exact organization coverage', () => {
  assert.equal(parseProductionSnapshot(fixture()).agentsByTenant, undefined);
  const parsed = parseProductionSnapshot(agentTenantsFixture());
  assert.deepEqual(parsed.agentsByTenant!.rows, [
    { tenantId: 'tenant-a', tenantName: 'Example tenant', organizations: 2, agents: 2, authentication: 1, provisioning: 2 },
  ]);
  assert.equal(parsed.rows.reduce((sum, row) => sum + row.agents, 0), 3);
  assert.equal(parsed.agentsByTenant!.rows[0].agents, 2);
  const unmapped = agentTenantsFixture();
  unmapped.agentsByTenant.rows = [];
  unmapped.agentsByTenant.rowCount = 0;
  unmapped.agentsByTenant.unmapped = { organizations: 2, agents: 2, authentication: 2, provisioning: 2 };
  assert.equal(parseProductionSnapshot(unmapped).agentsByTenant!.unmapped.agents, 2);
  const approximateOrganizations = agentTenantsFixture();
  approximateOrganizations.totals.organizations = 3;
  assert.equal(parseProductionSnapshot(approximateOrganizations).agentsByTenant!.rows[0].organizations, 2);
});

test('tenant detection snapshots reject partial coverage, conflicts, duplicates, invalid identities, counts and metadata', () => {
  const valid = agentTenantsFixture();
  const attribution = valid.agentsByTenant;
  const row = attribution.rows[0];
  for (const [update, pattern] of [
    [{ rowCount: 2 }, /truncated/],
    [{ mapping: 'caller-home-tenant' }, /mappings/],
    [{ conflictingOrganizationMappings: 1 }, /mappings/],
    [{ asOf: 'invalid' }, /timestamps/],
    [{ asOf: '9999-11-05T18:00:00Z' }, /future/],
    [{ rows: [{ ...row, organizations: 1 }] }, /every detected organization/],
    [{ rowCount: 2, rows: [row, { ...row, tenantId: 'tenant-a' }] }, /duplicate/],
    [{ rows: [{ ...row, tenantId: '00000000-0000-0000-0000-000000000000' }] }, /Unset/],
    [{ rows: [{ ...row, tenantId: ' ' }] }, /tenant IDs/],
    [{ rows: [{ ...row, tenantName: null }] }, /names/],
    [{ rows: [{ ...row, agents: -1 }] }, /counts/],
    [{ rows: [{ ...row, organizations: 1.5 }] }, /counts/],
    [{ rows: [{ ...row, agents: 0 }] }, /together/],
    [{ rows: [{ ...row, authentication: 0, provisioning: 0 }] }, /together/],
    [{ rows: [{ ...row, organizations: 0 }] }, /together/],
    [{ unmapped: { organizations: 0, agents: 0, authentication: 1, provisioning: 0 } }, /together/],
    [{ unmapped: undefined }, /object/],
  ] as const) {
    assert.throws(() => parseProductionSnapshot({ ...valid, agentsByTenant: { ...attribution, ...update } }), pattern);
  }
  const noName = parseProductionSnapshot({ ...valid, agentsByTenant: {
    ...attribution, rows: [{ ...row, tenantName: ' ' }],
  } });
  assert.equal(noName.agentsByTenant!.rows[0].tenantName, undefined);
});

const wauFixture = () => ({
  ...fixture(),
  wau: {
    scope: 'detected-cohort-nonbatch-success', countMethod: 'approximate-hll2', agents: 2,
    daily: Array.from({ length: 8 }, (_, index) => ({ day: daysBefore('2026-10-29', -index), agents: index < 3 ? 1 : 2 })),
  },
});

test('observed WAU is optional, uses all intersecting UTC dates and ends at the weekly distinct estimate', () => {
  assert.equal(parseProductionSnapshot(fixture()).wau, undefined);
  const parsed = parseProductionSnapshot(wauFixture());
  assert.equal(parsed.wau!.daily.length, 8);
  assert.equal(parsed.wau!.agents, 2);
  assert.equal(parsed.wau!.daily.reduce((sum, day) => sum + day.agents, 0), 13);
  const serializedDates = wauFixture();
  serializedDates.wau.daily.forEach(day => { day.day += 'T00:00:00.0000000Z'; });
  assert.equal(parseProductionSnapshot(serializedDates).wau!.daily[0].day, '2026-10-29');
  const zero = wauFixture();
  zero.wau.agents = 0;
  zero.wau.daily.forEach(day => { day.agents = 0; });
  assert.equal(parseProductionSnapshot(zero).wau!.agents, 0);
  const midnight = wauFixture();
  midnight.startTime = '2026-10-29T00:00:00Z';
  midnight.endTime = '2026-11-05T00:00:00Z';
  midnight.wau.daily.pop();
  assert.equal(parseProductionSnapshot(midnight).wau!.daily.length, 7);
});

test('observed WAU rejects incomplete coverage, misaligned dates, unsupported scope and inconsistent totals', () => {
  const missing = wauFixture();
  missing.wau.daily.pop();
  assert.throws(() => parseProductionSnapshot(missing), /coverage/);
  const wrongDay = wauFixture();
  wrongDay.wau.daily[0].day = '2026-10-28';
  assert.throws(() => parseProductionSnapshot(wrongDay), /align/);
  assert.throws(() => parseProductionSnapshot({ ...wauFixture(), wau: { ...wauFixture().wau, scope: 'all-agents' } }), /scope/);
  assert.throws(() => parseProductionSnapshot({ ...wauFixture(), wau: { ...wauFixture().wau, agents: 3 } }), /final/);
});

test('production snapshot rejects missing/truncated rows, invalid counts, duplicate IDs and invalid windows', () => {
  assert.throws(() => parseProductionSnapshot({ ...fixture(), rowCount: 3 }), /truncated/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), rows: [fixture().rows[0], fixture().rows[0]] }), /duplicate/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), totals: { ...fixture().totals, agents: -1 } }), /counts/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), startTime: '2026-11-04T17:00:00Z' }), /seven days/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), startTime: 'invalid' }), /timestamps/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), startTime: '2026-02-30T17:00:00Z' }), /timestamps/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), dataMode: 'synthetic' }), /contract/);
});

const callFixture = () => ({
  ...wauFixture(),
  wau: {
    ...wauFixture().wau,
    daily: wauFixture().wau.daily.map((row, index) => ({ ...row, agents: index === 7 ? 2 : 1 })),
  },
  callVolume: {
    scope: 'detected-cohort-nonbatch-success', countMethod: 'distinct-request-ids',
    calls: 16, missingRequestIds: 0, conflictingRequestIds: 0,
    daily: Array.from({ length: 8 }, (_, index) => ({ day: daysBefore('2026-10-29', -index), calls: index === 0 ? 10 : index === 7 ? 6 : 0 })),
  },
});

test('weekly call volume counts individual requests, aligns dates and sums daily volumes without replacing WAU', () => {
  assert.equal(parseProductionSnapshot(fixture()).callVolume, undefined);
  const parsed = parseProductionSnapshot(callFixture());
  assert.equal(parsed.wau!.agents, 2);
  assert.equal(parsed.callVolume!.calls, 16);
  assert.equal(parsed.callVolume!.daily.reduce((sum, row) => sum + row.calls, 0), 16);
  const serialized = callFixture();
  serialized.callVolume.daily.forEach(row => { row.day += 'T00:00:00.0000000Z'; });
  assert.equal(parseProductionSnapshot(serialized).callVolume!.daily[0].day, '2026-10-29');
  const zero = callFixture();
  zero.callVolume.calls = 0;
  zero.callVolume.daily.forEach(row => { row.calls = 0; });
  zero.wau.agents = 0;
  zero.wau.daily.forEach(row => { row.agents = 0; });
  assert.equal(parseProductionSnapshot(zero).callVolume!.calls, 0);
  const midnight = callFixture();
  midnight.startTime = '2026-10-29T00:00:00Z';
  midnight.endTime = '2026-11-05T00:00:00Z';
  midnight.callVolume.daily.pop();
  midnight.callVolume.calls = 10;
  midnight.wau.daily.pop();
  midnight.wau.agents = 1;
  assert.equal(parseProductionSnapshot(midnight).callVolume!.daily.length, 7);
});

test('call volume rejects partial request identities, unsupported scope, incomplete days and inconsistent totals', () => {
  for (const change of [
    { missingRequestIds: 1 }, { conflictingRequestIds: 1 }, { missingRequestIds: undefined },
    { countMethod: 'telemetry-rows' }, { scope: 'all-users' }, { calls: 17 }, { calls: -1 },
    { calls: 0, daily: callFixture().callVolume.daily.map(row => ({ ...row, calls: 0 })) },
    { daily: callFixture().callVolume.daily.map((row, index) => ({ ...row, calls: index === 7 ? 16 : 0 })) },
    { daily: callFixture().callVolume.daily.slice(1) },
    { daily: callFixture().callVolume.daily.map((row, index) => index ? row : { ...row, day: '2026-10-28' }) },
    { daily: callFixture().callVolume.daily.map((row, index) => index ? row : { ...row, calls: .5 }) },
    { daily: callFixture().callVolume.daily.map((row, index) => index ? row : { ...row, day: row.day + 'T01:00:00Z' }) },
  ]) {
    assert.throws(() => parseProductionSnapshot({ ...callFixture(), callVolume: { ...callFixture().callVolume, ...change } }));
  }
});

const tenantFixture = () => ({
  ...callFixture(),
  rowCount: 3,
  rows: [...fixture().rows, { organizationId: 'fixture-c', agents: 1, authentication: 1, provisioning: 0 }],
  totals: { ...fixture().totals, organizations: 3, authenticationPairs: 3 },
  callVolume: {
    ...callFixture().callVolume,
    byTenant: {
      mapping: 'organization-details', asOf: '2026-11-05T18:00:00Z',
      rowCount: 2, conflictingOrganizationMappings: 0, unmappedCalls: 2,
      rows: [{ tenantId: 'fixture-tenant-b', calls: 4 }, { tenantId: ' FIXTURE-TENANT-A ', calls: 10 }],
    },
  },
});

test('tenant attribution preserves all calls, normalizes and ranks tenants, and distinguishes unmapped from unavailable', () => {
  assert.equal(parseProductionSnapshot(callFixture()).callVolume!.byTenant, undefined);
  const parsed = parseProductionSnapshot(tenantFixture());
  const tenants = parsed.callVolume!.byTenant!;
  assert.equal(tenants.rows[0].tenantId, 'fixture-tenant-a');
  assert.equal(tenants.rows[0].calls, 10);
  assert.equal(tenants.rows.reduce((sum, row) => sum + row.calls, tenants.unmappedCalls), 16);
  assert.equal(parsed.wau!.agents, 2);
  const unmapped = tenantFixture();
  unmapped.callVolume.byTenant.rows = [];
  unmapped.callVolume.byTenant.rowCount = 0;
  unmapped.callVolume.byTenant.unmappedCalls = 16;
  assert.equal(parseProductionSnapshot(unmapped).callVolume!.byTenant!.unmappedCalls, 16);
  const zero = tenantFixture();
  zero.callVolume.calls = 0;
  zero.callVolume.daily.forEach(row => { row.calls = 0; });
  zero.wau.agents = 0;
  zero.wau.daily.forEach(row => { row.agents = 0; });
  zero.callVolume.byTenant.rows = [];
  zero.callVolume.byTenant.rowCount = 0;
  zero.callVolume.byTenant.unmappedCalls = 0;
  assert.equal(parseProductionSnapshot(zero).callVolume!.byTenant!.rows.length, 0);
});

test('tenant names are optional, trimmed display labels that do not alter IDs, ordering or counts', () => {
  const input = tenantFixture();
  const rows = input.callVolume.byTenant.rows.map((row, index) => ({
    ...row, tenantName: index ? '  Sample <North> & Partners  ' : '   ',
  }));
  const parsed = parseProductionSnapshot({ ...input, callVolume: {
    ...input.callVolume, byTenant: { ...input.callVolume.byTenant, rows },
  } });
  assert.deepEqual(parsed.callVolume!.byTenant!.rows, [
    { tenantId: 'fixture-tenant-a', tenantName: 'Sample <North> & Partners', calls: 10 },
    { tenantId: 'fixture-tenant-b', calls: 4 },
  ]);
  assert.equal(parsed.callVolume!.calls, 16);
  for (const tenantName of [null, 42, {}, ['Sample tenant']]) {
    assert.throws(() => parseProductionSnapshot({ ...input, callVolume: {
      ...input.callVolume, byTenant: { ...input.callVolume.byTenant,
        rows: [{ ...input.callVolume.byTenant.rows[0], tenantName }, input.callVolume.byTenant.rows[1]] },
    } }), /Tenant names must be strings/);
  }
});

test('tenant attribution rejects conflicting mappings, wrong attribution, truncated/duplicate rows and nonreconciling volumes', () => {
  const base = tenantFixture().callVolume.byTenant;
  for (const change of [
    { mapping: 'caller-home-tenant' }, { conflictingOrganizationMappings: 1 }, { conflictingOrganizationMappings: undefined },
    { asOf: 'invalid' }, { asOf: new Date(Date.now() + 120_000).toISOString() },
    { rowCount: 3 }, { rowCount: undefined }, { unmappedCalls: 3 }, { unmappedCalls: -1 },
    { rows: [base.rows[0], { ...base.rows[0], tenantId: 'FIXTURE-TENANT-B' }] },
    { rows: [base.rows[0], { ...base.rows[1], tenantId: '' }] },
    { rows: [base.rows[0], { ...base.rows[1], tenantId: '00000000-0000-0000-0000-000000000000' }] },
    { rows: [base.rows[0], { ...base.rows[1], calls: 0 }] },
    { rows: [base.rows[0], { ...base.rows[1], calls: .5 }] },
  ]) {
    assert.throws(() => parseProductionSnapshot({
      ...tenantFixture(), callVolume: { ...tenantFixture().callVolume, byTenant: { ...base, ...change } },
    }));
  }
});

test('private snapshot endpoint is read-only, uncached and blocks cross-origin and invalid Host access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-snapshot-test-'));
  const path = join(directory, 'fixture.json');
  await writeFile(path, JSON.stringify(fixture()));
  let middleware = snapshotMiddleware(path);
  const server = createServer((request, response) => {
    void middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/detection-snapshot`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).totals.agents, 2);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(url, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { Host: 'example.invalid' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(invalidHostStatus, 403);
    await writeFile(path, '{}');
    assert.equal((await fetch(url)).status, 503);
    middleware = snapshotMiddleware();
    assert.equal((await fetch(url)).status, 204);
    middleware = snapshotMiddleware(join(process.cwd(), 'README.md'));
    assert.equal((await fetch(url)).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true });
  }
});
