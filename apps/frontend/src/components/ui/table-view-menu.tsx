import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import {
  Menu, MenuCheckboxItem, MenuContent, MenuItemGroup, MenuItemGroupLabel, MenuItemIndicator, MenuItemText, MenuPositioner, MenuTrigger, MenuViewport,
} from '@legalio/ui-components/menu';

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
/** Column visibility menu (moduix Data Table block pattern). Children are TableViewOption items. */
export function TableViewMenu({ children, label, title, heading, className }: {
  children: React.ReactNode; label?: string; title?: string; heading?: string; className?: string;
}) {
  const { t } = useLanguage();
  const trigger = React.useId();
  const buttonLabel = label || t('io.view', 'View');
  const description = title || t('io.view_settings', 'Pengaturan Tampilan Kolom');
  return (
    <Menu ids={{ trigger }} closeOnSelect={false} positioning={{ placement: 'bottom-end', gutter: 8 }}>
      <Tooltip ids={{ trigger }}><TooltipTrigger asChild><MenuTrigger asChild>
        <Button variant="outline" className={className}>
          <SlidersHorizontal aria-hidden="true" />
          {buttonLabel}
        </Button>
      </MenuTrigger></TooltipTrigger><TooltipBody>{description}</TooltipBody></Tooltip>
      <MenuPositioner>
        <MenuContent aria-label={description}>
          <MenuViewport>
            <MenuItemGroup>
              <MenuItemGroupLabel>{heading || t('io.toggle_columns', 'Toggle Kolom')}</MenuItemGroupLabel>
              {children}
            </MenuItemGroup>
          </MenuViewport>
        </MenuContent>
      </MenuPositioner>
    </Menu>
  );
}

export function TableViewOption({ value, checked, onToggle, children }: { value: string; checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <MenuCheckboxItem value={value} checked={checked} onCheckedChange={onToggle}>
      <MenuItemIndicator />
      <MenuItemText>{children}</MenuItemText>
    </MenuCheckboxItem>
  );
}
