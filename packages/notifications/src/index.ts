import pino from 'pino';
import { isLocalEnv } from '@credisync/config';

const logger = pino({ name: 'notifications' });

export type NotificationChannel = 'email' | 'sms' | 'push';

export interface EmailNotification {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export interface SmsNotification {
  to: string;
  message: string;
}

export interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  messageId?: string;
  error?: string;
}

export interface NotificationProvider {
  sendEmail(notification: EmailNotification): Promise<NotificationResult>;
  sendSms(notification: SmsNotification): Promise<NotificationResult>;
}

export class NotificationNotConfiguredError extends Error {
  constructor(channel: NotificationChannel) {
    super(`${channel} delivery is not configured for NODE_ENV=${process.env.NODE_ENV}`);
    this.name = 'NotificationNotConfiguredError';
  }
}

/** Masks a recipient for logs: t***@example.co.za, +2782*****67. */
export function maskRecipient(to: string): string {
  if (to.includes('@')) {
    const [local, domain] = to.split('@');
    return `${(local ?? '').slice(0, 1)}***@${domain ?? ''}`;
  }
  return to.length > 6 ? `${to.slice(0, 5)}*****${to.slice(-2)}` : '*****';
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Minimal, accessible HTML version of a plain-text message (links made clickable). */
export function textToHtml(text: string): string {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  const linked = paragraphs.replace(
    /(https:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#0B7A70">$1</a>',
  );
  return `<!doctype html><html lang="en-ZA"><body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#12181F;max-width:560px;margin:0 auto;padding:24px">${linked}<p style="margin:24px 0 0;font-size:12px;color:#6B7684">CrediSync · You receive this because you have a CrediSync account.</p></body></html>`;
}

/**
 * Development provider: logs instead of sending. Recipients are masked;
 * message bodies (which can contain verification links) are logged only
 * when NODE_ENV=development.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  private readonly showBody = process.env.NODE_ENV === 'development';

  async sendEmail(notification: EmailNotification): Promise<NotificationResult> {
    logger.info(
      {
        to: maskRecipient(notification.to),
        subject: notification.subject,
        ...(this.showBody ? { body: notification.body } : {}),
      },
      'email notification (console)',
    );
    return { success: true, channel: 'email', messageId: `console-${Date.now()}` };
  }

  async sendSms(notification: SmsNotification): Promise<NotificationResult> {
    logger.info(
      {
        to: maskRecipient(notification.to),
        ...(this.showBody ? { message: notification.message } : {}),
      },
      'sms notification (console)',
    );
    return { success: true, channel: 'sms', messageId: `console-${Date.now()}` };
  }
}

/**
 * Amazon SES (v2 API) in af-south-1, so mail is sent from within South
 * Africa. SES has no SMTP endpoint in Cape Town; the HTTPS API is used.
 * SMS is not configured yet (deliberately), so sendSms throws outside
 * development.
 */
export class SesNotificationProvider implements NotificationProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clientPromise: Promise<{ m: any; client: any }> | null = null;

  constructor(
    private readonly fromAddress: string,
    private readonly region: string = process.env.AWS_REGION ?? 'af-south-1',
    private readonly configurationSet: string | undefined = process.env.SES_CONFIGURATION_SET,
  ) {
    if (region !== 'af-south-1')
      throw new Error(`SES region must be af-south-1 (data residency); got ${region}`);
  }

  private sdk() {
    this.clientPromise ??= import('@aws-sdk/client-sesv2').then((m) => ({
      m,
      client: new m.SESv2Client({ region: this.region }),
    }));
    return this.clientPromise;
  }

  async sendEmail(notification: EmailNotification): Promise<NotificationResult> {
    const { m, client } = await this.sdk();
    try {
      const out = await client.send(
        new m.SendEmailCommand({
          FromEmailAddress: this.fromAddress,
          Destination: { ToAddresses: [notification.to] },
          ConfigurationSetName: this.configurationSet,
          Content: {
            Simple: {
              Subject: { Data: notification.subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: notification.body, Charset: 'UTF-8' },
                Html: {
                  Data: notification.html ?? textToHtml(notification.body),
                  Charset: 'UTF-8',
                },
              },
            },
          },
        }),
      );
      return { success: true, channel: 'email', messageId: out.MessageId };
    } catch (err) {
      logger.error(
        { to: maskRecipient(notification.to), err: (err as Error).name },
        'SES send failed',
      );
      throw err;
    }
  }

  async sendSms(): Promise<NotificationResult> {
    throw new NotificationNotConfiguredError('sms');
  }
}

/** Used outside development when nothing is configured: fails loudly instead of dropping messages. */
class UnconfiguredProvider implements NotificationProvider {
  async sendEmail(): Promise<NotificationResult> {
    throw new NotificationNotConfiguredError('email');
  }
  async sendSms(): Promise<NotificationResult> {
    throw new NotificationNotConfiguredError('sms');
  }
}

export function defaultNotificationProvider(
  env: NodeJS.ProcessEnv = process.env,
): NotificationProvider {
  if (env.SES_FROM_ADDRESS)
    return new SesNotificationProvider(env.SES_FROM_ADDRESS, env.AWS_REGION ?? 'af-south-1');
  if (isLocalEnv(env)) return new ConsoleNotificationProvider();
  return new UnconfiguredProvider();
}

/** Startup check for services that send email. */
export function assertEmailConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (!isLocalEnv(env) && !env.SES_FROM_ADDRESS) {
    throw new NotificationNotConfiguredError('email');
  }
}

let provider: NotificationProvider | null = null;

export function setNotificationProvider(p: NotificationProvider | null): void {
  provider = p;
}

function current(): NotificationProvider {
  provider ??= defaultNotificationProvider();
  return provider;
}

export async function sendEmail(notification: EmailNotification): Promise<NotificationResult> {
  return current().sendEmail(notification);
}

export async function sendSms(notification: SmsNotification): Promise<NotificationResult> {
  return current().sendSms(notification);
}
