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
  assert.deepEqual(result.daily[1], { day: '2026-10-23', users: 3, cumulativeUsers: 3, organizations: 3, tenants: 1 });
  assert.deepEqual(result.totals, { users: 3, organizations: 3, tenants: 1, unmappedOrganizations: 1 });
  assert.equal(result.daily[0].users, 0);
  assert.equal(result.daily[2].users, 0);
  assert.deepEqual(result.daily[2], { day: '2026-10-24', users: 0, cumulativeUsers: 3, organizations: 3, tenants: 1 });
});

test('period totals are distinct across days, not sums of daily distincts', () => {
  const result = aggregateDaily([creation('u', 'o'), creation('u', 'o', '2026-10-22T10:00:00Z')], [], '2026-10-22', '2026-10-23');
  assert.equal(result.totals.users, 1);
  assert.equal(result.daily.reduce((sum, day) => sum + day.users, 0), 2);
  assert.deepEqual(result.daily.map(day => day.cumulativeUsers), [1, 1]);
});

test('cumulative users deduplicate across dates and organizations and include pre-range history', () => {
  const records = [
    creation('u2', 'o2', '2026-10-23T10:00:00Z'),
    creation('u1', 'o1', '2026-09-01T10:00:00Z'),
    creation('u1', 'o2', '2026-10-22T10:00:00Z'),
    creation('u2', 'o1', '2026-10-23T11:00:00Z'),
    creation('future', 'o3', '2026-10-25T00:00:00Z'),
  ];
  const result = aggregateDaily(records, [], '2026-10-21', '2026-10-24');
  assert.deepEqual(result.daily.map(day => day.users), [0, 1, 1, 0]);
  assert.deepEqual(result.daily.map(day => day.cumulativeUsers), [1, 1, 2, 2]);
  assert.deepEqual(aggregateDaily(records, [], '2026-10-23', '2026-10-24').daily, result.daily.slice(2));
  assert.equal(aggregateDaily(records, [], '2026-10-21', '2026-10-22').daily.at(-1)!.cumulativeUsers, 1);
  assert.equal(aggregateDaily(records, [], '2026-10-24', '2026-10-24').totals.users, 0);
});

test('accumulates distinct organizations and mapped tenants from history before the range', () => {
  const records = [
    creation('u4', 'o3', '2026-10-24T10:00:00Z'),
    creation('old', 'o1', '2026-09-01T10:00:00Z'),
    creation('u2', 'o2', '2026-10-22T10:00:00Z'),
    creation('u1', 'o1', '2026-10-22T11:00:00Z'),
    creation('u3', 'o2', '2026-10-23T10:00:00Z'),
    creation('old-unmapped', 'unmapped', '2026-09-02T10:00:00Z'),
    creation('future', 'future-org', '2026-10-25T00:00:00Z'),
  ];
  const mapping = [
    { organizationId: 'o1', tenantId: 'shared' },
    { organizationId: 'o2', tenantId: 'shared' },
    { organizationId: 'o3', tenantId: 'new' },
    { organizationId: 'future-org', tenantId: 'future-tenant' },
  ];
  const result = aggregateDaily(records, mapping, '2026-10-21', '2026-10-24');
  assert.deepEqual(result.daily, [
    { day: '2026-10-21', users: 0, cumulativeUsers: 2, organizations: 2, tenants: 1 },
    { day: '2026-10-22', users: 2, cumulativeUsers: 4, organizations: 3, tenants: 1 },
    { day: '2026-10-23', users: 1, cumulativeUsers: 5, organizations: 3, tenants: 1 },
    { day: '2026-10-24', users: 1, cumulativeUsers: 6, organizations: 4, tenants: 2 },
  ]);
  assert.deepEqual(result.totals, { users: 4, organizations: 4, tenants: 2, unmappedOrganizations: 1 });
  const narrower = aggregateDaily(records, mapping, '2026-10-23', '2026-10-24');
  assert.deepEqual(narrower.daily, result.daily.slice(2));
  assert.deepEqual(narrower.totals, { users: 2, organizations: 4, tenants: 2, unmappedOrganizations: 1 });
  const earlier = aggregateDaily(records, mapping, '2026-10-21', '2026-10-23');
  assert.equal(earlier.totals.organizations, 3);
  assert.equal(earlier.totals.tenants, 1);
});

test('carries history across empty dates without inflating counts and excludes future creations', () => {
  const result = aggregateDaily([
    creation('old', 'o', '2026-10-20T10:00:00Z'),
    creation('future', 'future-org', '2026-10-24T00:00:00Z'),
  ], [{ organizationId: 'o', tenantId: 't' }], '2026-10-21', '2026-10-23');
  assert.deepEqual(result.daily.map(({ users, organizations, tenants }) => ({ users, organizations, tenants })),
    Array.from({ length: 3 }, () => ({ users: 0, organizations: 1, tenants: 1 })));
  assert.deepEqual(result.totals, { users: 0, organizations: 1, tenants: 1, unmappedOrganizations: 0 });
  assert.deepEqual(result.daily.map(day => day.cumulativeUsers), [1, 1, 1]);
  assert.deepEqual(aggregateDaily([], [], '2026-10-23', '2026-10-23').daily,
    [{ day: '2026-10-23', users: 0, cumulativeUsers: 0, organizations: 0, tenants: 0 }]);
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
  assert.equal(data.historyStart, '2026-06-25');
  assert.ok(result.daily[0].organizations > 0 && result.daily[0].tenants > 0);
  assert.ok(result.daily[0].cumulativeUsers > result.daily[0].users);
  assert.ok(result.daily[0].organizations < result.daily.at(-1)!.organizations);
  assert.ok(result.daily[0].tenants < result.daily.at(-1)!.tenants);
  const emptyIndex = result.daily.findIndex((day, index) => index > 0 && day.users === 0);
  assert.ok(emptyIndex > 0);
  assert.equal(result.daily[emptyIndex].organizations, result.daily[emptyIndex - 1].organizations);
  assert.equal(result.daily[emptyIndex].tenants, result.daily[emptyIndex - 1].tenants);
  assert.equal(result.daily[emptyIndex].cumulativeUsers, result.daily[emptyIndex - 1].cumulativeUsers);
  for (let index = 1; index < result.daily.length; index++) {
    assert.ok(result.daily[index].cumulativeUsers >= result.daily[index - 1].cumulativeUsers);
    assert.ok(result.daily[index].organizations >= result.daily[index - 1].organizations);
    assert.ok(result.daily[index].tenants >= result.daily[index - 1].tenants);
  }
  assert.equal(result.totals.unmappedOrganizations, 1);
  assert.ok(result.totals.organizations > result.totals.tenants);
});
