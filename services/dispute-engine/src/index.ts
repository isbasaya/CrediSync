import pino from 'pino';
import { createPool } from '@credisync/db';
import { createApp } from './app';

const logger = pino({ name: 'dispute-engine' });
const pool = createPool();
const app = createApp(pool);

const port = Number(process.env.PORT ?? 4002);
const server = app.listen(port, () => logger.info(`dispute-engine listening on :${port}`));

function shutdown() {
  server.close(() => void pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
