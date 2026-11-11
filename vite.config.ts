import { defineConfig, loadEnv } from 'vite';
import type { Connect, Plugin } from 'vite';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { parseProductionSnapshot } from './src/snapshot.ts';
import { parseWbrSnapshot } from './src/wbr.ts';

export function snapshotMiddleware(snapshotPath?: string): Connect.NextHandleFunction {
  return privateSnapshotMiddleware(snapshotPath, '/api/detection-snapshot', parseProductionSnapshot, 'Production detection');
}

export function wbrSnapshotMiddleware(snapshotPath?: string): Connect.NextHandleFunction {
  return privateSnapshotMiddleware(snapshotPath, '/api/wbr-snapshot', parseWbrSnapshot, 'Weekly WBR');
}

function privateSnapshotMiddleware(snapshotPath: string | undefined, endpoint: string,
  parseSnapshot: (value: unknown) => unknown, label: string): Connect.NextHandleFunction {
  return async (request, response, next) => {
    if (request.url?.split('?')[0] !== endpoint) return next();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const host = request.headers.host;
    if (!host || !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)
      || (request.headers.origin && request.headers.origin !== `http://${host}`)) {
      response.statusCode = 403;
      response.end('Local access only.');
      return;
    }
    if (request.method !== 'GET') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET');
      response.end('Read-only endpoint.');
      return;
    }
    if (!snapshotPath) {
      response.statusCode = 204;
      response.end();
      return;
    }
    try {
      if (!isAbsolute(snapshotPath)) throw new Error('Snapshot path must be absolute.');
      const privatePath = await realpath(snapshotPath);
      const relativePath = relative(await realpath(process.cwd()), privatePath);
      if (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`)) {
        throw new Error('Production snapshot must be outside the repository.');
      }
      const snapshot = parseSnapshot(JSON.parse(await readFile(privatePath, 'utf8')));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(snapshot));
    } catch (error) {
      console.error(`${label} snapshot could not be loaded:`, error instanceof Error ? error.message : 'Unknown error');
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: `${label} snapshot is unavailable or invalid. No ${label.toLowerCase()} counts loaded.` }));
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const snapshotPlugin: Plugin = {
    name: 'local-private-snapshots',
    configureServer(server) {
      server.middlewares.use(snapshotMiddleware(env.DETECTION_SNAPSHOT_PATH));
      server.middlewares.use(wbrSnapshotMiddleware(env.WBR_SNAPSHOT_PATH));
    },
    configurePreviewServer(server) {
      server.middlewares.use(snapshotMiddleware(env.DETECTION_SNAPSHOT_PATH));
      server.middlewares.use(wbrSnapshotMiddleware(env.WBR_SNAPSHOT_PATH));
    },
  };
  return { plugins: [snapshotPlugin] };
});
