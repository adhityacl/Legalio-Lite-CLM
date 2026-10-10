import React from 'react';
import { DropdownMenu } from 'radix-ui';
import { MoreHorizontal } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
export interface ActionMenuItem {
  label: string; icon?: React.ReactNode; onClick: () => void;
  variant?: 'default' | 'danger'; dividerBefore?: boolean;
}
export interface ActionMenuProps { items: ActionMenuItem[]; title?: string; }
export const ActionMenu: React.FC<ActionMenuProps> = ({ items, title }) => {
  const { t } = useLanguage();
  const label = title || t('common.actions', 'Actions');
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" title={label} aria-label={label} onClick={e => e.stopPropagation()}
        className="inline-flex items-center justify-center min-w-10 min-h-10 rounded-md text-ink-soft hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={12}
        onClick={e => e.stopPropagation()}
        className="z-[1001] min-w-44 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto bg-surface border border-hairline rounded-xl shadow-xl p-1.5 animate-in">
        {items.map((item, index) => <React.Fragment key={index}>
          {item.dividerBefore && <DropdownMenu.Separator className="h-px bg-surface-2 my-1" />}
          <DropdownMenu.Item onSelect={item.onClick}
            className={`flex items-center gap-2 min-h-10 px-3 py-2 rounded-md text-sm cursor-pointer outline-none data-[highlighted]:bg-surface-2 dark:data-[highlighted]:bg-ink ${item.variant === 'danger' ? 'text-status-danger ' : 'text-ink '}`}>
            {item.icon}<span>{item.label}</span>
          </DropdownMenu.Item>
        </React.Fragment>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
};
