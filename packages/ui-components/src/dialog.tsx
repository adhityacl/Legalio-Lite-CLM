import React, { useRef } from 'react';
import { Dialog, DialogBackdrop, DialogContent, DialogPositioner } from '@moduix/react-tailwind/dialog';
import { cn } from './utils';

export * from '@moduix/react-tailwind/dialog';

const widths = { sm: 'w-[min(32rem,calc(100vw-2rem))]', md: 'w-[min(42rem,calc(100vw-2rem))]', lg: 'w-[min(56rem,calc(100vw-2rem))]' } as const;

/**
 * Product modal: an always-open moduix Dialog that the caller unmounts to close.
 * Focus returns to the element that opened it. Children own the header, body and footer.
 */
export function ModalFrame({ children, onClose, size = 'lg', className, role, ...props }: React.HTMLAttributes<HTMLDivElement> & {
  onClose: () => void;
  size?: keyof typeof widths;
  role?: 'dialog' | 'alertdialog';
}) {
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  return (
    <Dialog open role={role} onOpenChange={details => { if (!details.open) onClose(); }} closeOnInteractOutside={false} finalFocusEl={() => returnFocus.current}>
      <DialogBackdrop />
      <DialogPositioner>
        <DialogContent className={cn(widths[size], 'flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0', className)} {...props}>{children}</DialogContent>
      </DialogPositioner>
    </Dialog>
  );
}
