import type { aggregateDetections } from './detections.ts';
import { daysBefore } from './analytics.ts';

type DetectionCounts = ReturnType<typeof aggregateDetections>;
export interface ObservedWau {
  scope: 'detected-cohort-nonbatch-success';
  countMethod: 'approximate-hll2';
  agents: number;
  daily: { day: string; agents: number }[];
}

export interface ProductionSnapshot extends DetectionCounts {
  version: 1;
  dataMode: 'production';
  countMethod: 'approximate-hll2';
  coverage: 'configured-source-groups';
  rowCount: number;
  wau?: ObservedWau;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a snapshot object.');
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Snapshot counts must be nonnegative safe integers.');
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('Snapshot requires valid UTC timestamps.');
  return value;
}

function parseObservedWau(value: unknown, startTime: string, endTime: string): ObservedWau {
  const input = object(value);
  if (input.scope !== 'detected-cohort-nonbatch-success' || input.countMethod !== 'approximate-hll2') {
    throw new Error('Unsupported observed WAU scope.');
  }
  const endDay = endTime.slice(0, 10);
  const lastDay = /T00:00:00(?:\.0{1,7})?Z$/.test(endTime) ? daysBefore(endDay, 1) : endDay;
  const days: string[] = [];
  for (let day = startTime.slice(0, 10); day <= lastDay; day = daysBefore(day, -1)) days.push(day);
  if (!Array.isArray(input.daily) || input.daily.length !== days.length) {
    throw new Error('Observed WAU daily coverage is incomplete.');
  }
  const daily = input.daily.map((value, index) => {
    const row = object(value);
    const day = typeof row.day === 'string' ? row.day.replace(/T00:00:00(?:\.0{1,7})?Z$/, '') : undefined;
    if (day !== days[index]) throw new Error('Observed WAU dates must align with the snapshot window.');
    return { day: days[index], agents: count(row.agents) };
  });
  const agents = count(input.agents);
  if (daily.at(-1)!.agents !== agents) throw new Error('Observed WAU total must equal the final within-week cumulative estimate.');
  return { scope: 'detected-cohort-nonbatch-success', countMethod: 'approximate-hll2', agents, daily };
}

export function parseProductionSnapshot(value: unknown): ProductionSnapshot {
  const input = object(value);
  if (input.version !== 1 || input.dataMode !== 'production' || input.countMethod !== 'approximate-hll2'
    || input.coverage !== 'configured-source-groups') throw new Error('Unsupported production snapshot contract.');
  const startTime = timestamp(input.startTime), endTime = timestamp(input.endTime);
  if (Date.parse(endTime) - Date.parse(startTime) !== 7 * 86_400_000) {
    throw new Error('Production detection snapshot must cover exactly seven days.');
  }
  if (Date.parse(endTime) > Date.now() + 60_000) throw new Error('Production snapshot ends in the future.');
  if (!Array.isArray(input.rows) || input.rows.length !== count(input.rowCount)) {
    throw new Error('Snapshot rows are missing or truncated.');
  }
  const ids = new Set<string>();
  const rows = input.rows.map(value => {
    const row = object(value);
    if (typeof row.organizationId !== 'string' || !row.organizationId.trim()) throw new Error('Snapshot requires organization IDs.');
    const organizationId = row.organizationId.trim().toLowerCase();
    if (ids.has(organizationId)) throw new Error('Snapshot has duplicate organization rows.');
    ids.add(organizationId);
    return { organizationId, agents: count(row.agents), authentication: count(row.authentication), provisioning: count(row.provisioning) };
  }).sort((a, b) => b.agents - a.agents || a.organizationId.localeCompare(b.organizationId));
  const totals = object(input.totals);
  return {
    version: 1, dataMode: 'production', countMethod: 'approximate-hll2', coverage: 'configured-source-groups',
    startTime, endTime, rowCount: rows.length, rows,
    totals: {
      agents: count(totals.agents), organizations: count(totals.organizations),
      authenticationPairs: count(totals.authenticationPairs), provisioningPairs: count(totals.provisioningPairs),
    },
    ...(input.wau === undefined ? {} : { wau: parseObservedWau(input.wau, startTime, endTime) }),
  };
}
