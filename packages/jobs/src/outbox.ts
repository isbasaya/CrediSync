import type { Pool } from 'pg';
import pino from 'pino';
import { withSystem } from '@credisync/db';
import { isLocalEnv } from '@credisync/config';

const logger = pino({ name: 'jobs:outbox' });

export interface OutboxMessage {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  userId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface EventPublisher {
  publish(messages: OutboxMessage[]): Promise<{ failed: Set<string> }>;
}

/** Development: write events to the log. */
export class LogEventPublisher implements EventPublisher {
  async publish(messages: OutboxMessage[]) {
    for (const m of messages)
      logger.info({ eventId: m.eventId, eventType: m.eventType }, 'event (log publisher)');
    return { failed: new Set<string>() };
  }
}

/**
 * Amazon SNS (af-south-1). One topic; subscribers (SQS queues) filter on
 * the `event_type` message attribute. The event id is sent as the
 * message deduplication key for FIFO topics.
 */
export class SnsEventPublisher implements EventPublisher {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clientPromise: Promise<{ m: any; client: any }> | null = null;

  constructor(
    private readonly topicArn: string,
    private readonly region: string = process.env.AWS_REGION ?? 'af-south-1',
  ) {
    if (region !== 'af-south-1')
      throw new Error(`SNS region must be af-south-1 (data residency); got ${region}`);
  }

  private sdk() {
    this.clientPromise ??= import('@aws-sdk/client-sns').then((m) => ({
      m,
      client: new m.SNSClient({ region: this.region }),
    }));
    return this.clientPromise;
  }

  async publish(messages: OutboxMessage[]) {
    const { m, client } = await this.sdk();
    const failed = new Set<string>();
    const fifo = this.topicArn.endsWith('.fifo');
    // SNS PublishBatch accepts up to 10 entries.
    for (let i = 0; i < messages.length; i += 10) {
      const batch = messages.slice(i, i + 10);
      const out = await client.send(
        new m.PublishBatchCommand({
          TopicArn: this.topicArn,
          PublishBatchRequestEntries: batch.map((msg) => ({
            Id: msg.eventId,
            Message: JSON.stringify(msg),
            MessageAttributes: {
              event_type: { DataType: 'String', StringValue: msg.eventType },
              aggregate_type: { DataType: 'String', StringValue: msg.aggregateType },
            },
            ...(fifo
              ? {
                  MessageGroupId: msg.aggregateId ?? msg.eventId,
                  MessageDeduplicationId: msg.eventId,
                }
              : {}),
          })),
        }),
      );
      for (const f of out.Failed ?? []) if (f.Id) failed.add(f.Id);
    }
    return { failed };
  }
}

export function defaultPublisher(env: NodeJS.ProcessEnv = process.env): EventPublisher {
  if (env.EVENTS_TOPIC_ARN)
    return new SnsEventPublisher(env.EVENTS_TOPIC_ARN, env.AWS_REGION ?? 'af-south-1');
  if (isLocalEnv(env)) return new LogEventPublisher();
  throw new Error('EVENTS_TOPIC_ARN is required outside development');
}

const BATCH_SIZE = 100;
const MAX_BACKOFF_MINUTES = 60;

/**
 * Relays pending outbox events. Rows are claimed with FOR UPDATE SKIP
 * LOCKED, so several relays can run at once without double-sending; any
 * crash before commit leaves rows pending, so delivery is at-least-once.
 * Failures back off exponentially (1, 2, 4 … 60 minutes).
 */
export async function runOutboxRelay(
  pool: Pool,
  publisher: EventPublisher = defaultPublisher(),
): Promise<{ published: number; failed: number }> {
  return withSystem(pool, async (client) => {
    const r = await client.query(
      `SELECT id, event_id, event_type, aggregate_type, aggregate_id, user_id, payload, created_at, attempts
       FROM credisync.event_outbox
       WHERE published_at IS NULL AND next_attempt_at <= NOW()
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );
    if (r.rows.length === 0) return { published: 0, failed: 0 };

    const messages: OutboxMessage[] = r.rows.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      userId: row.user_id,
      occurredAt: new Date(row.created_at).toISOString(),
      payload: row.payload,
    }));

    let failedIds: Set<string>;
    let errorText = 'publish failed';
    try {
      failedIds = (await publisher.publish(messages)).failed;
    } catch (err) {
      errorText = (err as Error).message.slice(0, 500);
      failedIds = new Set(messages.map((m) => m.eventId));
    }

    const ok = messages.filter((m) => !failedIds.has(m.eventId)).map((m) => m.eventId);
    const bad = [...failedIds];
    if (ok.length > 0) {
      await client.query(
        'UPDATE credisync.event_outbox SET published_at = NOW() WHERE event_id = ANY($1::uuid[])',
        [ok],
      );
    }
    if (bad.length > 0) {
      await client.query(
        `UPDATE credisync.event_outbox
         SET attempts = attempts + 1,
             last_error = $2,
             next_attempt_at = NOW() + make_interval(mins => LEAST($3, power(2, attempts)::int))
         WHERE event_id = ANY($1::uuid[])`,
        [bad, errorText, MAX_BACKOFF_MINUTES],
      );
      logger.warn({ failed: bad.length }, 'some events failed to publish; will retry');
    }
    return { published: ok.length, failed: bad.length };
  });
}

/** Keeps relaying until the queue is drained (or a batch fails). */
export async function drainOutbox(
  pool: Pool,
  publisher: EventPublisher = defaultPublisher(),
): Promise<number> {
  let total = 0;
  for (;;) {
    const { published, failed } = await runOutboxRelay(pool, publisher);
    total += published;
    if (published === 0 || failed > 0) return total;
  }
}
