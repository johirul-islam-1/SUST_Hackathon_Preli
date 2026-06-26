// POST /analyze-ticket route
// Invokes the investigation pipeline and returns the result.

import { Router } from 'express';
import { runPipeline } from '../services/pipeline.js';
import { logger } from '../logger.js';

const router = Router();

router.post('/analyze-ticket', (req, res) => {
  try {
    const result = runPipeline(req.body);

    if (!result.success) {
      res.status(result.status).json(result.body);
      return;
    }

    res.status(200).json(result.response);
  } catch (err) {
    // Never leak stack traces
    logger.error({ err }, 'Unexpected error in /analyze-ticket');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
