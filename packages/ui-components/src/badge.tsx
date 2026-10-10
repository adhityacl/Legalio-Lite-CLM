import * as React from 'react';
import { Badge as ModuixBadge } from '@moduix/react-tailwind/badge';
import { cn } from './utils';

export { BadgeDot, BadgeLabel } from '@moduix/react-tailwind/badge';

/** Product status tones. moduix Badge ships neutral variants only, so tones are consumer utilities. */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'special' | 'finance' | 'neutral';

const toneClasses: Record<StatusTone, string> = {
  success: 'border-status-success-border bg-status-success-soft text-status-success',
  warning: 'border-status-warning-border bg-status-warning-soft text-status-warning',
  danger: 'border-status-danger-border bg-status-danger-soft text-status-danger',
  info: 'border-status-info-border bg-status-info-soft text-status-info',
  special: 'border-status-special-border bg-status-special-soft text-status-special',
  finance: 'border-status-finance-border bg-status-finance-soft text-status-finance',
  neutral: 'border-border bg-muted text-muted-foreground',
};

const statusWords: Array<[StatusTone, (s: string) => boolean]> = [
  ['success', s => ['aktif', 'active', 'lengkap', 'complete', 'available', 'recommended', 'berjalan', 'signed', 'success', 'excellent', 'sangat baik', 'bhi', 'never'].includes(s)],
  ['warning', s => ['akan berakhir', 'expiring', 'warning', 'belum lengkap', 'incomplete', 'missing', 'recommended with notes', 'review', 'fair', 'baik', 'moderate', 'rare', 'pending'].includes(s) || s.includes('hari lagi') || s.includes('days left')],
  ['danger', s => ['expired', 'kadaluarsa', 'terminated', 'not recommended', 'inactive', 'nonaktif', 'ditolak', 'danger', 'kurang baik', 'frequent', 'expensive', 'delete'].includes(s)],
  ['info', s => ['legal', 'good', 'info', 'selesai', 'cheap', 'bha', 'create', 'io', 'contract'].includes(s)],
  ['special', s => ['admin', 'addendum', 'auth', 'add_user'].includes(s)],
  ['finance', s => ['finance', 'spending', 'invoice'].includes(s)],
];

/** Maps a stored status label (any supported language) to its tone. */
export function statusTone(status: string): StatusTone {
  const s = (status || '').toLowerCase().trim();
  return statusWords.find(([, match]) => match(s))?.[0] ?? 'neutral';
}

export interface BadgeProps extends React.ComponentPropsWithoutRef<typeof ModuixBadge> {
  tone?: StatusTone;
}

/** moduix Badge with a product status tone. */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ tone = 'neutral', className, ...props }, ref) => (
  <ModuixBadge ref={ref} variant="outline" data-tone={tone} className={cn(toneClasses[tone], className)} {...props} />
));
Badge.displayName = 'Badge';
