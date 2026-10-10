import React from 'react';
import { ModalFrame as SharedModalFrame } from '@legalio/ui-components/dialog';
import { useOptionalActiveTab } from '../../context/NavigationContext';
import { tableDesignForTab } from '../../lib/tableDesign';
export function ModalFrame(props: React.ComponentProps<typeof SharedModalFrame>) {
  return <SharedModalFrame data-table-design={tableDesignForTab(useOptionalActiveTab())} {...props} />;
}
