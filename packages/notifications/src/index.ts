import pino from 'pino';

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

export class ConsoleNotificationProvider implements NotificationProvider {
  async sendEmail(notification: EmailNotification): Promise<NotificationResult> {
    logger.info({ to: notification.to, subject: notification.subject }, 'email notification (console)');
    return { success: true, channel: 'email', messageId: `console-${Date.now()}` };
  }

  async sendSms(notification: SmsNotification): Promise<NotificationResult> {
    logger.info({ to: notification.to, message: notification.message }, 'sms notification (console)');
    return { success: true, channel: 'sms', messageId: `console-${Date.now()}` };
  }
}

let provider: NotificationProvider = new ConsoleNotificationProvider();

export function setNotificationProvider(p: NotificationProvider): void {
  provider = p;
}

export async function sendEmail(notification: EmailNotification): Promise<NotificationResult> {
  return provider.sendEmail(notification);
}

export async function sendSms(notification: SmsNotification): Promise<NotificationResult> {
  return provider.sendSms(notification);
}

export async function notifyDisputeSubmitted(email: string, disputeId: string): Promise<NotificationResult> {
  return sendEmail({
    to: email,
    subject: 'Your dispute has been submitted',
    body: `Your dispute (ID: ${disputeId}) has been submitted to the credit bureau. You will be notified of updates.`,
  });
}

export async function notifyDisputeResolved(email: string, disputeId: string, upheld: boolean): Promise<NotificationResult> {
  return sendEmail({
    to: email,
    subject: 'Dispute resolution update',
    body: `Your dispute (ID: ${disputeId}) has been ${upheld ? 'upheld — the bureau has corrected the record' : 'rejected — the bureau found the record accurate'}.`,
  });
}

export async function notifyScoreChange(email: string, newScore: number, band: string): Promise<NotificationResult> {
  return sendEmail({
    to: email,
    subject: 'Your credit score has been updated',
    body: `Your credit score is now ${newScore} (${band}). Log in to see the full details.`,
  });
}
