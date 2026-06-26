// Express server — QueueStorm Investigation Engine
// Binds to 0.0.0.0:${PORT|8080}
// Routes: GET /health, POST /analyze-ticket

import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import healthRoute from './routes/health.js';
import analyzeRoute from './routes/analyze.js';

const app = express();
const PORT = parseInt(process.env['PORT'] || '8080', 10);

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger, autoLogging: false }));

// Routes
app.use(healthRoute);
app.use(analyzeRoute);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler — never leak stack traces
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server — only when run directly (not when imported by tests)
import { pathToFileURL } from 'url';
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, llm_used: false }, 'QueueStorm Investigation Engine started');
  });
}

export { app };
