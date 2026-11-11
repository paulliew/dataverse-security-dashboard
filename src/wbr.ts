import { count, object, timestamp } from './snapshot.ts';

export const observationStart = '2026-10-19T00:00:00Z';
const day = 86_400_000;

export type WeeklyMetric = { status: 'verified'; value: number } | { status: 'unavailable'; reason: string };
export type WeeklyCalls = (Extract<WeeklyMetric, { status: 'verified' }> & {
  missingRequestIds: 0; conflictingRequestIds: 0;
}) | Extract<WeeklyMetric, { status: 'unavailable' }>;

export interface WbrWeek {
  startTime: string;
  endTime: string;
  identities: WeeklyMetric;
  calls: WeeklyCalls;
}

export interface WbrSnapshot {
  version: 1;
  dataMode: 'production';
  coverage: 'configured-source-groups';
  observationStart: string;
  asOf: string;
  identityCountMethod: 'exact-distinct-identities';
  callCountMethod: 'distinct-request-ids';
  callScope: 'detected-cohort-nonbatch-success';
  baseline: { endTime: string; identities: WeeklyMetric };
  weeks: WbrWeek[];
}

export function completedWbrWeeks(now = Date.now()): { startTime: string; endTime: string }[] {
  if (!Number.isFinite(now)) throw new Error('WBR requires a valid reference time.');
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  const end = date.getTime() - (date.getUTCDay() + 6) % 7 * day;
  return Array.from({ length: 3 }, (_, index) => ({
    startTime: new Date(end - (3 - index) * 7 * day).toISOString(),
    endTime: new Date(end - (2 - index) * 7 * day).toISOString(),
  }));
}

function metric(value: unknown): WeeklyMetric {
  const input = object(value);
  if (input.status === 'verified') {
    if (input.reason !== undefined) throw new Error('Verified WBR values cannot have an unavailable reason.');
    return { status: 'verified', value: count(input.value) };
  }
  if (input.status !== 'unavailable' || typeof input.reason !== 'string' || !input.reason.trim()
    || input.value !== undefined) throw new Error('Unavailable WBR metrics require a reason and no numeric value.');
  return { status: 'unavailable', reason: input.reason.trim() };
}

export function weekOverWeek(current: WeeklyMetric, previous: WeeklyMetric): number | undefined {
  if (current.status !== 'verified' || previous.status !== 'verified' || previous.value === 0) return undefined;
  return (current.value - previous.value) / previous.value * 100;
}

export function parseWbrSnapshot(value: unknown, now = Date.now()): WbrSnapshot {
  const input = object(value);
  if (input.version !== 1 || input.dataMode !== 'production' || input.coverage !== 'configured-source-groups'
    || input.identityCountMethod !== 'exact-distinct-identities' || input.callCountMethod !== 'distinct-request-ids'
    || input.callScope !== 'detected-cohort-nonbatch-success') throw new Error('Unsupported weekly WBR snapshot contract.');
  const start = timestamp(input.observationStart);
  if (Date.parse(start) % day !== 0) throw new Error('WBR observation must start at midnight UTC.');
  const asOf = timestamp(input.asOf);
  if (Date.parse(asOf) > now + 60_000) throw new Error('WBR snapshot read time is in the future.');
  const expected = completedWbrWeeks(Date.parse(asOf));
  if (Date.parse(expected.at(-1)!.endTime) > now) throw new Error('WBR may only include completed weeks.');
  if (Date.parse(expected[0].startTime) < Date.parse(start)) {
    throw new Error('WBR requires three complete weeks after the observation start.');
  }
  const baselineInput = object(input.baseline);
  const baselineTime = timestamp(baselineInput.endTime);
  if (Date.parse(baselineTime) !== Date.parse(expected[0].startTime)) {
    throw new Error('WBR requires the preceding week-end identity baseline.');
  }
  const baseline = { endTime: expected[0].startTime, identities: metric(baselineInput.identities) };
  if (Date.parse(baseline.endTime) === Date.parse(start)
    && baseline.identities.status === 'verified' && baseline.identities.value !== 0) {
    throw new Error('The identity baseline at the observation start must describe an empty interval.');
  }
  if (!Array.isArray(input.weeks) || input.weeks.length !== 3) throw new Error('WBR requires exactly three completed weeks.');
  let previous = baseline.identities;
  const weeks = input.weeks.map((value, index): WbrWeek => {
    const row = object(value);
    if (Date.parse(timestamp(row.startTime)) !== Date.parse(expected[index].startTime)
      || Date.parse(timestamp(row.endTime)) !== Date.parse(expected[index].endTime)) {
      throw new Error('WBR weeks must be consecutive completed Monday-Sunday UTC periods, oldest first.');
    }
    const identities = metric(row.identities);
    if (identities.status === 'verified') {
      if (previous.status === 'verified' && identities.value < previous.value) {
        throw new Error('Cumulative WBR identity totals cannot decrease.');
      }
      previous = identities;
    }
    const callInput = object(row.calls);
    const parsedCalls = metric(callInput);
    const calls: WeeklyCalls = parsedCalls.status === 'unavailable' ? parsedCalls : {
      ...parsedCalls, missingRequestIds: 0, conflictingRequestIds: 0,
    };
    if (parsedCalls.status === 'verified'
      && (callInput.missingRequestIds !== 0 || callInput.conflictingRequestIds !== 0)) {
      throw new Error('WBR calls require complete, unambiguous request IDs.');
    }
    if (identities.status === 'verified' && identities.value === 0
      && calls.status === 'verified' && calls.value > 0) {
      throw new Error('Successful Agent calls require observed identities.');
    }
    return { ...expected[index], identities, calls };
  });
  return {
    version: 1, dataMode: 'production', coverage: 'configured-source-groups', observationStart: start, asOf,
    identityCountMethod: 'exact-distinct-identities', callCountMethod: 'distinct-request-ids',
    callScope: 'detected-cohort-nonbatch-success', baseline, weeks,
  };
}
