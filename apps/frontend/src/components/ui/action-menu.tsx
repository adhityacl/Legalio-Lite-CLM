import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Menu, MenuContent, MenuItem, MenuPositioner, MenuSeparator, MenuTrigger, MenuViewport } from '@legalio/ui-components/menu';

export interface ActionMenuItem {
  label: string; icon?: React.ReactNode; onClick: () => void;
  variant?: 'default' | 'danger'; dividerBefore?: boolean;
}
export interface ActionMenuProps { items: ActionMenuItem[]; title?: string; }

/** Row actions: moduix Menu behind an icon trigger (Data Table block pattern). */
export const ActionMenu: React.FC<ActionMenuProps> = ({ items, title }) => {
  const { t } = useLanguage();
  const label = title || t('common.actions', 'Actions');
  return (
    <Menu positioning={{ placement: 'bottom-end', gutter: 8 }} onSelect={details => items[Number(details.value)]?.onClick()}>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" title={label} aria-label={label} onClick={e => e.stopPropagation()}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </MenuTrigger>
      <MenuPositioner>
        <MenuContent onClick={e => e.stopPropagation()}>
          <MenuViewport>
            {items.map((item, index) => (
              <React.Fragment key={index}>
                {item.dividerBefore && <MenuSeparator />}
                <MenuItem value={String(index)} tone={item.variant === 'danger' ? 'destructive' : 'default'}>
                  {item.icon}{item.label}
                </MenuItem>
              </React.Fragment>
            ))}
          </MenuViewport>
        </MenuContent>
      </MenuPositioner>
    </Menu>
  );
};
