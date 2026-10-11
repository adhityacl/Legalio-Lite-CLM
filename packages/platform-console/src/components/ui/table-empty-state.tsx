import React from 'react';
import { Inbox } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

import { TableEmpty } from '@legalio/ui-components/table';
import { Empty, EmptyActions, EmptyContent, EmptyDescription, EmptyIcon } from '@legalio/ui-components/empty';
interface EmptyContentProps {
  /** Overrides the generic "no data" sentence, e.g. to say what is missing. */
  message?: string;
  /** Optional next step, such as a "New document" button. */
  action?: React.ReactNode;
  /** Lucide icon shown above the message; defaults to an inbox. */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

const EmptyState: React.FC<EmptyContentProps & { framed?: boolean }> = ({ message, action, icon: Icon = Inbox, framed = true }) => {
  const { t } = useLanguage();
  return (
    <Empty className={framed ? undefined : 'border-0 bg-transparent'}>
      <EmptyIcon><Icon aria-hidden="true" /></EmptyIcon>
      <EmptyContent>
        <EmptyDescription>{message || t('common.no_data', 'Belum ada data untuk ditampilkan')}</EmptyDescription>
      </EmptyContent>
      {action && <EmptyActions>{action}</EmptyActions>}
    </Empty>
  );
};

export const TableEmptyState: React.FC<EmptyContentProps & { colSpan: number }> = ({ colSpan, ...content }) => (
  // TableEmpty renders its own row. The sticky wrapper keeps the message centered
  // in the visible area when a wide table scrolls sideways.
  <TableEmpty colSpan={colSpan}>
    <div className="sticky left-0 w-full max-w-full">
      <EmptyState {...content} framed={false} />
    </div>
  </TableEmpty>
);

export const TableEmptyMessage: React.FC<EmptyContentProps> = (content) => <EmptyState {...content} />;
