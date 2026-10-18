import type { NotificationLog } from '@legalio/types';

type Translate = (key: string, defaultText?: string, vars?: Record<string, string | number>) => string;

const REMINDER_DAYS = /^Reminder (?:(\d+)d|H-(\d+))$/;

/**
 * Reminder text in the viewer's UI language. The server stores `message` in the
 * organization language; rows that carry `message_params` (or commercial-document
 * reminders, whose text has no extra data) are rebuilt from their fields.
 * Anything else falls back to the stored `message`.
 */
export function notificationMessage(notif: NotificationLog, t: Translate): string {
  const reference = notif.parent_number;
  const title = notif.parent_title;
  if (!reference || !title) return notif.message;

  const params = notif.message_params;
  const legacy = REMINDER_DAYS.exec(notif.notification_type || '');
  const days = params?.daysRemaining ?? (legacy ? Number(legacy[1] ?? legacy[2]) : NaN);
  const isContract = params ? params.kind === 'contract' : notif.parent_type === 'Contract';
  // Older contract reminders lack the notice period, so their stored text stays authoritative.
  if (!Number.isFinite(days) || (!params && isContract)) return notif.message;

  const first = t('notifications.reminder_expires', '{reference} ({title}) berakhir dalam {days} hari.', { reference, title, days });
  if (!isContract || !params) return first;
  const notice = t('notifications.reminder_notice', 'Pemberitahuan {noticeType} diperlukan {noticeDays} hari sebelumnya.', {
    noticeType: params.noticeType || 'Termination',
    noticeDays: params.noticeDays ?? 30,
  });
  return `${first} ${notice}`;
}
