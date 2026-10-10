import React from 'react';
import { Inbox } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface EmptyContentProps {
  /** Overrides the generic "no data" sentence, e.g. to say what is missing. */
  message?: string;
  /** Optional next step, such as a "New document" button. */
  action?: React.ReactNode;
  /** Lucide icon shown above the message; defaults to an inbox. */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

const EmptyContent: React.FC<EmptyContentProps> = ({ message, action, icon: Icon = Inbox }) => {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <Icon className="size-6 text-ink-soft" aria-hidden="true" />
      <p className="text-sm font-medium text-ink-soft">
        {message || t('common.no_data', 'Belum ada data untuk ditampilkan')}
      </p>
      {action}
    </div>
  );
};

export const TableEmptyState: React.FC<EmptyContentProps & { colSpan: number }> = ({ colSpan, ...content }) => (
  <tr>
    <td colSpan={colSpan} className="p-0">
      {/* Sticky and capped to the scroll container's width (100cqw; tables whose
          wrapper is not an @container fall back to the viewport) so the message
          stays centered in the visible area when a wide table scrolls sideways. */}
      <div className="sticky left-0 w-full max-w-[min(100cqw,calc(100vw-2rem))] px-4">
        <EmptyContent {...content} />
      </div>
    </td>
  </tr>
);

export const TableEmptyMessage: React.FC<EmptyContentProps> = (content) => (
  <div className="px-4">
    <EmptyContent {...content} />
  </div>
);
