import { defineConfig, loadEnv } from 'vite';
import type { Connect, Plugin } from 'vite';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { parseProductionSnapshot } from './src/snapshot.ts';

export function snapshotMiddleware(snapshotPath?: string): Connect.NextHandleFunction {
  return async (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/detection-snapshot') return next();
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
      const snapshot = parseProductionSnapshot(JSON.parse(await readFile(privatePath, 'utf8')));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(snapshot));
    } catch (error) {
      console.error('Production detection snapshot could not be loaded:', error instanceof Error ? error.message : 'Unknown error');
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'Production detection snapshot is unavailable or invalid. No production counts loaded.' }));
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const middleware = snapshotMiddleware(env.DETECTION_SNAPSHOT_PATH);
  const snapshotPlugin: Plugin = {
    name: 'local-detection-snapshot',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
  return { plugins: [snapshotPlugin] };
});
