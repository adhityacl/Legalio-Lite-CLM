import type { HTMLArkProps } from '@ark-ui/react/factory';
import { ark } from '@ark-ui/react/factory';
import type { ComponentRef } from 'react';
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

const Empty = forwardRef<ComponentRef<typeof ark.div>, HTMLArkProps<'div'>>(function Empty(
  { className, ...props },
  ref,
) {
  return (
    <ark.div
      ref={ref}
      {...props}
      data-scope="empty"
      data-part="root"
      className={cn(
        'grid w-full min-w-0 justify-items-center gap-g13 p-g34 text-center text-muted-foreground',
        className,
      )}
      data-slot="empty-root"
    />
  );
});

const EmptyIcon = forwardRef<ComponentRef<typeof ark.div>, HTMLArkProps<'div'>>(function EmptyIcon(
  { className, ...props },
  ref,
) {
  return (
    <ark.div
      ref={ref}
      {...props}
      data-scope="empty"
      data-part="icon"
      className={cn(
        'inline-flex size-g55 min-w-0 items-center justify-center rounded-full bg-muted p-0 text-muted-foreground [&_svg]:pointer-events-none [&_svg]:size-g26 [&_svg]:shrink-0',
        className,
      )}
      data-slot="empty-icon"
    />
  );
});

const EmptyContent = forwardRef<ComponentRef<typeof ark.div>, HTMLArkProps<'div'>>(
  function EmptyContent({ className, ...props }, ref) {
    return (
      <ark.div
        ref={ref}
        {...props}
        data-scope="empty"
        data-part="content"
        className={cn('grid max-w-g377 min-w-0 justify-items-center gap-g5', className)}
        data-slot="empty-content"
      />
    );
  },
);

const EmptyTitle = forwardRef<ComponentRef<typeof ark.h3>, HTMLArkProps<'h3'>>(function EmptyTitle(
  { className, ...props },
  ref,
) {
  return (
    <ark.h3
      ref={ref}
      {...props}
      data-scope="empty"
      data-part="title"
      className={cn('min-w-0 text-xl font-semibold wrap-anywhere', className)}
      data-slot="empty-title"
    />
  );
});

const EmptyDescription = forwardRef<ComponentRef<typeof ark.div>, HTMLArkProps<'div'>>(
  function EmptyDescription({ className, ...props }, ref) {
    return (
      <ark.div
        ref={ref}
        {...props}
        data-scope="empty"
        data-part="description"
        className={cn(
          'min-w-0 text-sm wrap-anywhere text-muted-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0',
          className,
        )}
        data-slot="empty-description"
      />
    );
  },
);

const EmptyActions = forwardRef<ComponentRef<typeof ark.div>, HTMLArkProps<'div'>>(
  function EmptyActions({ className, ...props }, ref) {
    return (
      <ark.div
        ref={ref}
        {...props}
        data-scope="empty"
        data-part="actions"
        className={cn(
          'flex max-w-full min-w-0 flex-wrap items-center justify-center gap-g8 [&>*]:max-w-full [&>*]:min-w-0 [&>:is(button,a)]:wrap-anywhere [&>:is(button,a)]:whitespace-normal',
          className,
        )}
        data-slot="empty-actions"
      />
    );
  },
);

export { Empty, EmptyActions, EmptyContent, EmptyDescription, EmptyIcon, EmptyTitle };