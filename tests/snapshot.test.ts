import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProductionSnapshot } from '../src/snapshot.ts';
import { snapshotMiddleware } from '../vite.config.ts';

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

test('production snapshot rejects missing/truncated rows, invalid counts, duplicate IDs and invalid windows', () => {
  assert.throws(() => parseProductionSnapshot({ ...fixture(), rowCount: 3 }), /truncated/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), rows: [fixture().rows[0], fixture().rows[0]] }), /duplicate/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), totals: { ...fixture().totals, agents: -1 } }), /counts/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), startTime: '2026-11-04T17:00:00Z' }), /seven days/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), startTime: 'invalid' }), /timestamps/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), startTime: '2026-02-30T17:00:00Z' }), /timestamps/);
  assert.throws(() => parseProductionSnapshot({ ...fixture(), dataMode: 'synthetic' }), /contract/);
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
