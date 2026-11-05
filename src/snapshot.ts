import type { aggregateDetections } from './detections.ts';

type DetectionCounts = ReturnType<typeof aggregateDetections>;
export interface ProductionSnapshot extends DetectionCounts {
  version: 1;
  dataMode: 'production';
  countMethod: 'approximate-hll2';
  coverage: 'configured-source-groups';
  rowCount: number;
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
  };
}
