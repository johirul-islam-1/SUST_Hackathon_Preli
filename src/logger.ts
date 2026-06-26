import pino from 'pino';

const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const LOG_COMPLAINTS = process.env['LOG_COMPLAINTS'] === '1';

export const logger = pino({
  level: LOG_LEVEL,
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
  redact: LOG_COMPLAINTS ? [] : ['complaint', 'req.body.complaint'],
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;
