import pino from 'pino';
import { createPool } from '@credisync/db';
import { runDeletionRequests, runDisputeDeadlineMonitor, runPartitionMaintenance, runRetention } from './jobs';

/**
 * Scheduled jobs. Run from a scheduler (e.g. EventBridge Scheduler → ECS task):
 *   jobs deadlines    hourly
 *   jobs deletions    hourly
 *   jobs retention    daily
 *   jobs partitions   monthly (idempotent)
 *   jobs all          everything, in a safe order
 */
const logger = pino({ name: 'jobs' });

async function main(): Promise<void> {
  const pool = createPool({ max: 2 });
  const command = process.argv[2] ?? 'all';
  try {
    switch (command) {
      case 'retention':
        await runRetention(pool);
        break;
      case 'partitions':
        await runPartitionMaintenance(pool);
        break;
      case 'deadlines':
        await runDisputeDeadlineMonitor(pool);
        break;
      case 'deletions':
        await runDeletionRequests(pool);
        break;
      case 'all':
        await runPartitionMaintenance(pool);
        await runDisputeDeadlineMonitor(pool);
        await runDeletionRequests(pool);
        await runRetention(pool);
        break;
      default:
        logger.error({ command }, 'unknown job command');
        process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'job failed');
  process.exit(1);
});
