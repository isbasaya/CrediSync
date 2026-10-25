import pino from 'pino';
import { createPool } from '@credisync/db';
import { createApp } from './app';

const logger = pino({ name: 'auth-service' });
const pool = createPool();
const app = createApp(pool);

const port = Number(process.env.PORT ?? 4004);
const server = app.listen(port, () => logger.info(`auth-service listening on :${port}`));

function shutdown() {
  server.close(() => void pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
