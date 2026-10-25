import { describe, it, expect, afterEach } from 'vitest';
import {
  assertEmailConfigured,
  ConsoleNotificationProvider,
  defaultNotificationProvider,
  maskRecipient,
  NotificationNotConfiguredError,
  SesNotificationProvider,
  sendEmail,
  setNotificationProvider,
  textToHtml,
} from '../index';

afterEach(() => setNotificationProvider(null));

describe('provider selection', () => {
  it('uses SES when a from-address is configured', () => {
    expect(
      defaultNotificationProvider({
        NODE_ENV: 'production',
        SES_FROM_ADDRESS: 'no-reply@credisync.co.za',
      }),
    ).toBeInstanceOf(SesNotificationProvider);
  });

  it('logs to the console in development', () => {
    expect(defaultNotificationProvider({ NODE_ENV: 'development' })).toBeInstanceOf(
      ConsoleNotificationProvider,
    );
  });

  it('fails loudly in production when email is not configured', async () => {
    setNotificationProvider(defaultNotificationProvider({ NODE_ENV: 'production' }));
    await expect(sendEmail({ to: 'a@b.co', subject: 's', body: 'b' })).rejects.toBeInstanceOf(
      NotificationNotConfiguredError,
    );
    expect(() => assertEmailConfigured({ NODE_ENV: 'production' })).toThrow();
    expect(() => assertEmailConfigured({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('keeps SES in af-south-1', () => {
    expect(() => new SesNotificationProvider('x@y.co', 'eu-west-1')).toThrow(/af-south-1/);
  });
});

describe('formatting', () => {
  it('escapes HTML and links https URLs', () => {
    const html = textToHtml(
      'Hello <b>you</b>\n\nVerify: https://app.credisync.co.za/verify?token=abc',
    );
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('<a href="https://app.credisync.co.za/verify?token=abc"');
  });

  it('masks recipients for logs', () => {
    expect(maskRecipient('thandi@example.co.za')).toBe('t***@example.co.za');
    expect(maskRecipient('+27821234567')).toBe('+2782*****67');
  });
});
