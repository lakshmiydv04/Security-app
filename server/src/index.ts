import { createServer } from 'node:http';
import { createApp } from './http/app.js';
import { attachRealtime } from './realtime/io.js';
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';
import { PreflightError, runPreflight } from './lib/preflight.js';

/**
 * Interface to bind.
 *
 * Node already defaults to every interface, so this is not strictly a fix -
 * but a hosting platform that probes for an open port (Render, Fly, Railway)
 * is far easier to debug when the binding is stated rather than implied, and
 * stating it rules the question out for good.
 *
 * The PORT itself must come from the environment: hosted platforms assign one
 * at boot and route traffic only to that. env.PORT already reads process.env
 * and falls back to 4000 for local development.
 */
const HOST = process.env.HOST ?? '0.0.0.0';

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
    // Worth saying plainly, because the platform's own error points elsewhere:
    // the process is exiting here, so nothing ever binds a port, and Render
    // will report "no open ports detected". That message is the symptom. The
    // cause is printed above, and is usually an unset DATABASE_URL or
    // migrations that have not been applied to the production database.
    process.stderr.write(
      '\nThe server did not start, so a hosting platform will report that no ' +
        'port was detected. That is a symptom of the failure above, not a ' +
        'separate problem.\n',
    );
    process.exit(1);
  }
  throw err;
}

server.listen(env.PORT, HOST, () => {
  logger.info({ port: env.PORT, host: HOST, env: env.NODE_ENV }, 'server listening');
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
