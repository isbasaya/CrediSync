import pino from 'pino';
import { createPool } from '@credisync/db';
import { createApp, loadConfig } from './app';

const logger = pino({ name: 'api-gateway' });
const pool = createPool();
const app = createApp(pool, loadConfig());

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => logger.info(`api-gateway listening on :${port}`));

function shutdown() {
  server.close(() => void pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
