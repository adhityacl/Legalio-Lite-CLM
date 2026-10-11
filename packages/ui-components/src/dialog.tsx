import React, { useRef } from 'react';
import { Dialog, DialogBackdrop, DialogContent, DialogPositioner } from './moduix/ui/dialog';
import { cn } from './moduix/lib/cn';

export * from './moduix/ui/dialog';

// STANDARD.md §4.3 dialog widths: sm 377 / md 610 (default, forms) / form 720 / lg 987 / xl 1597.
const widths = { sm: 'w-full max-w-g377', md: 'w-full max-w-g610', lg: 'w-full max-w-g987', xl: 'w-full max-w-g1597', form: 'w-full max-w-form-wide' } as const;

/**
 * Product modal: an always-open moduix Dialog that the caller unmounts to close.
 * Focus returns to the element that opened it. Children own the header, body and footer.
 */
export function ModalFrame({ children, onClose, size = 'md', className, role, ...props }: React.HTMLAttributes<HTMLDivElement> & {
  onClose: () => void;
  size?: keyof typeof widths;
  role?: 'dialog' | 'alertdialog';
}) {
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  return (
    <Dialog open role={role} onOpenChange={details => { if (!details.open) onClose(); }} closeOnInteractOutside={false} finalFocusEl={() => returnFocus.current}>
      <DialogBackdrop />
      <DialogPositioner>
        <DialogContent className={cn(widths[size], 'flex flex-col overflow-hidden p-0', className)} {...props}>{children}</DialogContent>
      </DialogPositioner>
    </Dialog>
  );
}
