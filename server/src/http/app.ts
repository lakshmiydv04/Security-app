import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from '../lib/logger.js';
import { loadEnv } from '../lib/env.js';
import { authRoutes } from './routes/auth.routes.js';
import { pairingRoutes } from './routes/pairing.routes.js';
import { privacyRoutes } from './routes/privacy.routes.js';
import { sensorRoutes } from './routes/sensor.routes.js';
import { locationRoutes } from './routes/location.routes.js';
import { geofenceRoutes } from './routes/geofence.routes.js';
import { sosRoutes } from './routes/sos.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { rtcRoutes } from './routes/rtc.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export function createApp(): Express {
  const env = loadEnv();
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(pinoHttp({ logger }));

  // The API has no browser-facing pages, so hitting the root used to return a
  // bare NOT_FOUND that reads like a broken server. It was not broken - there
  // is simply nothing at '/'. Say so, and point at what does exist.
  app.get('/', (_req, res) => {
    res.json({
      service: 'guardian-api',
      status: 'ok',
      message: 'This is the API, not a website. The dashboard runs separately.',
      endpoints: {
        health: '/health',
        auth: '/api/auth/{register,login,refresh,logout}',
        pairings: '/api/pairings',
        realtime: 'socket.io on this same origin',
      },
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/pairings', pairingRoutes);
  app.use('/api', privacyRoutes);
  app.use('/api', sensorRoutes);
  app.use('/api', locationRoutes);
  app.use('/api', geofenceRoutes);
  app.use('/api', sosRoutes);
  app.use('/api', auditRoutes);
  app.use('/api', rtcRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
