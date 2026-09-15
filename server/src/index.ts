import { createServer } from 'node:http';
import { createApp } from './http/app.js';
import { attachRealtime } from './realtime/io.js';
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';
import { PreflightError, runPreflight } from './lib/preflight.js';

const env = loadEnv();
const app = createApp();
const server = createServer(app);
const realtime = attachRealtime(server);

// Refuse to listen against a database that would make every request fail.
// The message is printed raw rather than logged, because a wall of JSON is
// the last thing someone needs while debugging startup.
try {
  await runPreflight();
} catch (err) {
  if (err instanceof PreflightError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server listening');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await realtime.close();
  server.close(() => process.exit(0));
  // Do not let a hung connection hold the process open indefinitely.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
