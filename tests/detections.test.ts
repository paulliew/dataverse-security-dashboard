import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDetections, aggregateTenantDetections } from '../src/detections.ts';
import type { AgentDetection } from '../src/detections.ts';
import { loadSampleData } from '../src/sampleData.ts';

const start = '2026-11-04T17:00:00Z', end = '2026-11-05T17:00:00Z';
const detection = (organizationId: string, agentId: string,
  source: AgentDetection['source'] = 'authentication', timestamp = start): AgentDetection =>
  ({ organizationId, agentId, source, timestamp });

test('detections deduplicate across sources, repeated records and ID casing within each organization', () => {
  const result = aggregateDetections([
    detection('ORG-A', 'AGENT-1'), detection('org-a', 'agent-1'),
    detection('org-a', 'agent-1', 'provisioning'),
    detection('org-a', 'agent-2', 'provisioning'),
    detection('org-b', 'agent-1'),
    detection('org-c', 'agent-3', 'provisioning'),
    detection('', 'agent-4'), detection('org-d', ' '),
  ], start, end);
  assert.deepEqual(result.rows, [
    { organizationId: 'org-a', agents: 2, authentication: 1, provisioning: 2 },
    { organizationId: 'org-b', agents: 1, authentication: 1, provisioning: 0 },
    { organizationId: 'org-c', agents: 1, authentication: 0, provisioning: 1 },
  ]);
  assert.deepEqual(result.totals, { agents: 3, organizations: 3, authenticationPairs: 2, provisioningPairs: 3 });
});

test('detection window includes start, excludes end and ignores out-of-window records', () => {
  const result = aggregateDetections([
    detection('a', 'at-start'),
    detection('b', 'at-end', 'authentication', end),
    detection('c', 'before', 'authentication', '2026-11-04T16:59:59Z'),
    detection('d', 'after', 'provisioning', '2026-11-05T17:00:01Z'),
    detection('a', 'offset', 'authentication', '2026-11-04T09:00:00-08:00'),
  ], start, end);
  assert.equal(result.totals.agents, 2);
  assert.equal(result.totals.organizations, 1);
  assert.equal(aggregateDetections([], start, end).rows.length, 0);
  assert.throws(() => aggregateDetections([], end, start), /time window/);
  assert.throws(() => aggregateDetections([], 'invalid', end), /time window/);
  assert.throws(() => aggregateDetections([detection('a', 'b', 'authentication', 'invalid')], start, end), /timestamp/);
});

test('weekly detections include older signals, deduplicate across days and enforce exact 168-hour boundaries', () => {
  const weeklyStart = '2026-10-29T17:00:00Z';
  const result = aggregateDetections([
    detection('a', 'at-start', 'authentication', weeklyStart),
    detection('a', 'at-start', 'provisioning', '2026-11-02T17:00:00Z'),
    detection('a', 'at-start', 'authentication', '2026-11-04T18:00:00Z'),
    detection('a', 'older-than-one-day', 'authentication', '2026-10-31T12:00:00Z'),
    detection('a', 'recent', 'authentication', '2026-11-05T16:59:59.999Z'),
    detection('a', 'before', 'authentication', '2026-10-29T16:59:59.999Z'),
    detection('a', 'at-end', 'authentication', end),
  ], weeklyStart, end);
  assert.deepEqual(result.rows, [{ organizationId: 'a', agents: 3, authentication: 3, provisioning: 1 }]);
  const sample = loadSampleData(new Date(end));
  const weekly = aggregateDetections(sample.detections, weeklyStart, end);
  const daily = aggregateDetections(sample.detections, start, end);
  assert.equal(weekly.totals.agents, 6);
  assert.ok(weekly.totals.agents > daily.totals.agents);
  assert.equal(Date.parse(end) - Date.parse(weeklyStart), 168 * 3_600_000);
});

test('tenant detections union identities across organizations, sources and days rather than adding organization counts', () => {
  const result = aggregateTenantDetections([
    detection('ORG-A', 'AGENT-1'), detection('org-a', 'agent-1'),
    detection('org-a', 'agent-1', 'provisioning'),
    detection('org-b', 'agent-1', 'provisioning', '2026-11-05T16:00:00Z'),
    detection('org-b', 'agent-2'), detection('org-c', 'agent-1'),
    detection('unmapped-a', 'agent-1'), detection('unmapped-b', 'agent-1', 'provisioning'),
    detection('unset', 'agent-3'), detection('unknown', 'agent-3'),
    detection('org-b', 'excluded', 'authentication', end),
    detection('outside', 'excluded', 'provisioning', '2026-11-04T16:59:59Z'),
    detection('', 'excluded'), detection('org-a', ''),
  ], [
    { organizationId: 'ORG-A', tenantId: ' TENANT-A ' },
    { organizationId: 'org-a', tenantId: 'tenant-a' },
    { organizationId: 'org-b', tenantId: 'tenant-a' },
    { organizationId: 'org-c', tenantId: 'tenant-b' },
    { organizationId: 'unmapped-a', tenantId: null },
    { organizationId: 'unset', tenantId: '00000000-0000-0000-0000-000000000000' },
  ], start, end);
  assert.deepEqual(result, {
    rows: [
      { tenantId: 'tenant-a', organizations: 2, agents: 2, authentication: 2, provisioning: 1 },
      { tenantId: 'tenant-b', organizations: 1, agents: 1, authentication: 1, provisioning: 0 },
    ],
    unmapped: { organizations: 4, agents: 2, authentication: 2, provisioning: 1 },
  });
});

test('tenant detections reject conflicting mappings and invalid windows, and distinguish empty from unmapped cohorts', () => {
  assert.deepEqual(aggregateTenantDetections([], [], start, end), {
    rows: [], unmapped: { organizations: 0, agents: 0, authentication: 0, provisioning: 0 },
  });
  assert.equal(aggregateTenantDetections([detection('a', 'one')], [], start, end).unmapped.agents, 1);
  assert.throws(() => aggregateTenantDetections([], [
    { organizationId: 'A', tenantId: 'first' }, { organizationId: 'a', tenantId: 'second' },
  ], start, end), /Conflicting/);
  assert.throws(() => aggregateTenantDetections([], [{ organizationId: ' ', tenantId: 'a' }], start, end), /organization ID/);
  assert.throws(() => aggregateTenantDetections([], [], end, start), /time window/);
});
