import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completedWbrWeeks, parseWbrSnapshot, weekOverWeek } from '../src/wbr.ts';
import { wbrSnapshotMiddleware } from '../vite.config.ts';
import { wbrFixture } from './fixtures/wbr.ts';

test('WBR uses three completed Monday-Sunday UTC weeks, independent of DST and year boundaries', () => {
  const end = (time: string) => completedWbrWeeks(Date.parse(time)).at(-1)!.endTime;
  assert.equal(end('2026-11-08T23:59:59Z'), '2026-11-02T00:00:00.000Z');
  assert.equal(end('2026-11-09T00:00:00Z'), '2026-11-09T00:00:00.000Z');
  assert.equal(end('2026-11-11T20:00:00-08:00'), '2026-11-09T00:00:00.000Z');
  assert.deepEqual(completedWbrWeeks(Date.parse('2027-01-04T00:00:00Z'))[0],
    { startTime: '2026-12-14T00:00:00.000Z', endTime: '2026-12-21T00:00:00.000Z' });
  assert.throws(() => completedWbrWeeks(NaN), /reference time/);
});

test('WBR retains independently supplied cumulative totals, exact calls and the fourth baseline for WoW', () => {
  const report = parseWbrSnapshot(wbrFixture());
  const totals = report.weeks.map(week => week.identities);
  assert.deepEqual(totals, [20, 30, 30].map(value => ({ status: 'verified', value })));
  assert.equal(weekOverWeek(totals[0], report.baseline.identities), 100);
  assert.equal(weekOverWeek(totals[1], totals[0]), 50);
  assert.equal(weekOverWeek(totals[2], totals[1]), 0);
  assert.deepEqual(report.weeks.map(week => week.calls.status === 'verified' ? week.calls.value : undefined), [12, 25, 0]);
  assert.equal(weekOverWeek(totals[0], { status: 'verified', value: 0 }), undefined);
  assert.equal(weekOverWeek(totals[0], { status: 'unavailable', reason: 'Missing history' }), undefined);
});

test('unavailable WBR identities do not erase verified calls or become zeros; unknown prior totals block growth', () => {
  const input = wbrFixture();
  const unknown = { status: 'unavailable', reason: '  Historical coverage unverified  ' };
  const report = parseWbrSnapshot({ ...input,
    baseline: { ...input.baseline, identities: unknown },
    weeks: input.weeks.map((week, index) => ({ ...week, identities: index === 1 ? unknown : week.identities })),
  });
  assert.deepEqual(report.weeks[1].identities, { status: 'unavailable', reason: 'Historical coverage unverified' });
  assert.equal(report.weeks[1].calls.status, 'verified');
  assert.equal(weekOverWeek(report.weeks[2].identities, report.weeks[1].identities), undefined);
  assert.throws(() => parseWbrSnapshot({ ...input, weeks: input.weeks.map((week, index) => ({
    ...week, identities: index === 1 ? unknown : { status: 'verified', value: index === 0 ? 20 : 19 },
  })) }), /cannot decrease/);
});

test('WBR preserves the declared observation start and uses an empty baseline for the first observation week', () => {
  const input = wbrFixture();
  const report = parseWbrSnapshot({ ...input, observationStart: '2026-10-19T00:00:00Z',
    baseline: { ...input.baseline, identities: { status: 'verified', value: 0 } },
  });
  assert.equal(report.observationStart, '2026-10-19T00:00:00Z');
  assert.equal(weekOverWeek(report.weeks[0].identities, report.baseline.identities), undefined);
  assert.equal(weekOverWeek(report.weeks[1].identities, report.weeks[0].identities), 50);
  assert.equal(parseWbrSnapshot(input).observationStart, '2026-10-01T00:00:00Z');
  assert.throws(() => parseWbrSnapshot({ ...report,
    baseline: { ...report.baseline, identities: { status: 'verified', value: 1 } },
  }), /empty interval/);
});

test('WBR rejects invalid methods, dates, partial weeks, decreasing totals and unsafe metrics', () => {
  const input = wbrFixture();
  assert.throws(() => parseWbrSnapshot({ ...input, asOf: '2026-11-09T00:00:15Z' },
    Date.parse('2026-11-08T23:59:45Z')), /only include completed weeks/);
  for (const change of [
    { version: 2 }, { dataMode: 'synthetic' }, { coverage: 'worldwide' },
    { identityCountMethod: 'approximate-hll2' }, { callScope: 'all-traffic' },
    { callCountMethod: 'row-count' }, { observationStart: '2026-10-19T01:00:00Z' },
    { observationStart: '2026-10-20T00:00:00Z' }, { observationStart: '2026-02-30T00:00:00Z' },
    { asOf: '2026-02-30T12:00:00Z' }, { asOf: '9999-11-11T12:00:00Z' },
    { baseline: undefined }, { baseline: { ...input.baseline, endTime: '2026-10-18T00:00:00Z' } },
    { weeks: input.weeks.slice(1) }, { weeks: input.weeks.toReversed() },
    { weeks: input.weeks.map((week, index) => index ? week : { ...week, startTime: '2026-10-19T01:00:00Z' }) },
    { weeks: input.weeks.map((week, index) => index ? week : { ...week, endTime: '2026-10-25T00:00:00Z' }) },
  ]) assert.throws(() => parseWbrSnapshot({ ...input, ...change }));
  for (const identities of [
    { status: 'verified', value: -1 }, { status: 'verified', value: .5 },
    { status: 'verified', value: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'verified', value: 5 }, { status: 'verified', value: 20, reason: 'Missing' },
    { status: 'unavailable', reason: '' }, { status: 'unavailable', reason: 'Missing', value: 0 },
    { status: 'unknown', value: 0 }, null,
  ]) assert.throws(() => parseWbrSnapshot({ ...input, weeks: [{ ...input.weeks[0], identities }, ...input.weeks.slice(1)] }));
  for (const calls of [
    { status: 'verified', value: 12 },
    { status: 'verified', value: 12, missingRequestIds: 1, conflictingRequestIds: 0 },
    { status: 'verified', value: 12, missingRequestIds: 0, conflictingRequestIds: 1 },
    { status: 'unavailable', reason: 'Missing', value: 0 },
  ]) assert.throws(() => parseWbrSnapshot({ ...input, weeks: [{ ...input.weeks[0], calls }, ...input.weeks.slice(1)] }));
});

test('WBR endpoint is independently configured, localhost-only, read-only and never returns invalid counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-wbr-test-'));
  const path = join(directory, 'fixture.json');
  await writeFile(path, JSON.stringify(wbrFixture()));
  let middleware = wbrSnapshotMiddleware(path);
  const server = createServer((request, response) => {
    void middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/wbr-snapshot`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).weeks[2].calls.value, 0);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(url, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { Host: 'example.invalid' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(badHost, 403);
    assert.equal((await fetch(url.replace('wbr-snapshot', 'detection-snapshot'))).status, 404);
    await writeFile(path, '{}');
    assert.equal((await fetch(url)).status, 503);
    middleware = wbrSnapshotMiddleware();
    assert.equal((await fetch(url)).status, 204);
    middleware = wbrSnapshotMiddleware(join(process.cwd(), 'README.md'));
    assert.equal((await fetch(url)).status, 503);
    middleware = wbrSnapshotMiddleware('relative.json');
    assert.equal((await fetch(url)).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true });
  }
});
