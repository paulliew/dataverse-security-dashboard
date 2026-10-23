import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDaily, correlateCreations, daysBefore } from '../src/analytics.ts';
import type { TraceEvent, Creation } from '../src/analytics.ts';
import { loadSampleData } from '../src/sampleData.ts';

const creation = (userObjectId: string, organizationId: string, timestamp = '2026-10-23T10:00:00Z'): Creation =>
  ({ correlationId: `c-${userObjectId}-${organizationId}`, timestamp, userObjectId, organizationId });

test('correlates before range filtering and assigns the UTC creation day across midnight', () => {
  const events: TraceEvent[] = [
    { correlationId: 'a', timestamp: '2026-10-22T23:59:00Z', kind: 'agentIdentified', userObjectId: 'u', organizationId: 'o' },
    { correlationId: 'a', timestamp: '2026-10-22T23:59:59Z', kind: 'applyUser' },
    { correlationId: 'a', timestamp: '2026-10-23T00:00:01Z', kind: 'userCreated' },
    { correlationId: 'a', timestamp: '2026-10-23T00:00:02Z', kind: 'userCreated' },
  ];
  const records = correlateCreations(events);
  assert.equal(records.length, 1);
  const result = aggregateDaily(records, [], '2026-10-22', '2026-10-23');
  assert.deepEqual(result.daily.map(day => day.users), [0, 1]);
});

test('requires agent identification, creation, qualifying operation and correlation', () => {
  const dataset = loadSampleData(new Date('2026-10-23T10:00:00Z'));
  const valid = dataset.events.slice(0, 3);
  assert.equal(correlateCreations(valid).length, 1);
  for (let missing = 0; missing < 3; missing++) {
    assert.equal(correlateCreations(valid.filter((_, index) => index !== missing)).length, 0);
  }
  assert.equal(correlateCreations(valid.map(event => ({ ...event, correlationId: '' }))).length, 0);
  assert.equal(correlateCreations(valid.map(event => event.kind === 'forceSync' ? { ...event, kind: 'applyUser' } : event)).length, 1);
});

test('counts distinct users, organizations and mapped tenants rather than operations', () => {
  const records = [creation('u1', 'o1'), creation('u1', 'o1'), creation('u2', 'o2'), creation('u3', 'o3')];
  const mapping = [
    { organizationId: 'o1', tenantId: 't1' },
    { organizationId: 'o1', tenantId: 't1' },
    { organizationId: 'o2', tenantId: 't1' },
    { organizationId: 'o3', tenantId: null },
  ];
  const result = aggregateDaily(records, mapping, '2026-10-22', '2026-10-24');
  assert.deepEqual(result.daily[1], { day: '2026-10-23', users: 3, organizations: 3, tenants: 1 });
  assert.deepEqual(result.totals, { users: 3, organizations: 3, tenants: 1, unmappedOrganizations: 1 });
  assert.equal(result.daily[0].users, 0);
  assert.equal(result.daily[2].users, 0);
});

test('period totals are distinct across days, not sums of daily distincts', () => {
  const result = aggregateDaily([creation('u', 'o'), creation('u', 'o', '2026-10-22T10:00:00Z')], [], '2026-10-22', '2026-10-23');
  assert.equal(result.totals.users, 1);
  assert.equal(result.daily.reduce((sum, day) => sum + day.users, 0), 2);
});

test('fails explicitly on conflicting tenant mappings, ambiguous correlations and invalid input', () => {
  assert.throws(() => aggregateDaily([], [{ organizationId: 'o', tenantId: 't1' }, { organizationId: 'o', tenantId: 't2' }], '2026-10-23', '2026-10-23'), /Conflicting/);
  assert.throws(() => aggregateDaily([], [], '2026-10-24', '2026-10-23'), /date range/);
  assert.throws(() => aggregateDaily([], [], '2026-02-30', '2026-10-23'), /date range/);
  assert.throws(() => correlateCreations([
    { correlationId: 'a', timestamp: '2026-10-23', kind: 'agentIdentified', userObjectId: 'u1', organizationId: 'o' },
    { correlationId: 'a', timestamp: '2026-10-23', kind: 'agentIdentified', userObjectId: 'u2', organizationId: 'o' },
  ]), /Ambiguous/);
});

test('90 days ago through today yields 91 aligned UTC buckets, deterministic synthetic data', () => {
  const now = new Date('2026-10-23T18:19:58Z');
  const data = loadSampleData(now);
  assert.deepEqual(data, loadSampleData(now));
  assert.equal(daysBefore(data.asOf, 90), '2026-07-25');
  const result = aggregateDaily(correlateCreations(data.events), data.organizationDetails, daysBefore(data.asOf, 90), data.asOf);
  assert.equal(result.daily.length, 91);
  assert.equal(result.daily[0].day, '2026-07-25');
  assert.equal(result.daily.at(-1)!.day, '2026-10-23');
  assert.ok(result.daily.some(day => day.users === 0 && day.organizations === 0 && day.tenants === 0));
  assert.equal(result.totals.unmappedOrganizations, 1);
  assert.ok(result.totals.organizations > result.totals.tenants);
});
