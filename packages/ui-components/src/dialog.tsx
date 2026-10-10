import React, { useRef } from 'react';
import { Dialog, DialogBackdrop, DialogPositioner, DialogContent, DialogTitle } from '@moduix/react-tailwind/dialog';
import { cn } from './utils';
export const ModalTitle = DialogTitle;
export function ModalFrame({ children, onClose, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { onClose: () => void }) {
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  return <Dialog open onOpenChange={details => { if (!details.open) onClose(); }} closeOnInteractOutside={false} finalFocusEl={() => returnFocus.current}>
    <DialogBackdrop className="ds-dialog-backdrop" />
    <DialogPositioner className="ds-dialog-positioner">
      <DialogContent className={cn('ds-dialog form-dialog', className)} {...props}>{children}</DialogContent>
    </DialogPositioner>
  </Dialog>;
}
