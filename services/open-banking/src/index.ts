import pino from 'pino';
import { createPool } from '@credisync/db';
import { verifyStartupConfig } from '@credisync/middleware';
import { createApp } from './app';

const logger = pino({ name: 'open-banking' });
// Fail at boot, not on the first request, if a secret is missing.
verifyStartupConfig({ encryption: true, database: true });
const pool = createPool();
const app = createApp(pool);

const port = Number(process.env.PORT ?? 4003);
const server = app.listen(port, () => logger.info(`open-banking listening on :${port}`));

function shutdown() {
  server.close(() => void pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
