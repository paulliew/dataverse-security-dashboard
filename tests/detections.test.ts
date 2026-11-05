import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDetections } from '../src/detections.ts';
import type { AgentDetection } from '../src/detections.ts';

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
