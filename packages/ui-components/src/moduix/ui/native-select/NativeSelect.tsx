'use client';

import { Field as FieldPrimitive } from '@ark-ui/react/field';
import type { ComponentProps, ComponentRef } from 'react';
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { useStandaloneFieldId } from '../../lib/use-standalone-field-id';
import { ChevronDownIcon } from '../../lib/icons/ui';

type NativeSelectProps = ComponentProps<typeof FieldPrimitive.Select> & {
  controlProps?: ComponentProps<'span'>;
};

const NativeSelect = forwardRef<ComponentRef<typeof FieldPrimitive.Select>, NativeSelectProps>(
  function NativeSelect({ className, controlProps, multiple, size, ...props }, ref) {
    const isList = multiple || (size !== undefined && size > 1);
    const id = useStandaloneFieldId(props.id, props.name);

    return (
      <span
        {...controlProps}
        data-scope="native-select"
        data-part="control"
        data-slot="native-select-control"
        className={cn('relative inline-grid w-full max-w-full min-w-0', controlProps?.className)}
      >
        <FieldPrimitive.Select
          {...props}
          {...(id ? { id } : {})}
          ref={ref}
          data-scope="field"
          data-part="select"
          data-slot="native-select-root"
          multiple={multiple}
          size={size}
          className={cn(
            'peer/native-select box-border h-control-md w-full max-w-full min-w-0 cursor-pointer appearance-none rounded-md border border-border bg-background ps-g13 pe-g34 text-foreground outline-1 -outline-offset-1 outline-transparent transition-[background-color,border-color,outline-color,opacity] duration-200 ease-in-out font-sans text-sm focus-visible:border-ring focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive aria-invalid:focus-visible:outline-destructive data-disabled:pointer-events-none data-disabled:opacity-50 data-invalid:border-destructive data-invalid:outline-destructive data-invalid:focus-visible:outline-destructive motion-reduce:transition-none forced-colors:appearance-auto forced-colors:pe-g13',
            isList && 'h-auto appearance-auto px-g13 py-g8',
            className,
          )}
        />
        <span
          aria-hidden="true"
          data-scope="native-select"
          data-part="indicator"
          data-slot="native-select-indicator"
          className={cn(
            'pointer-events-none absolute end-g8 top-1/2 inline-flex size-g26 -translate-y-1/2 items-center justify-center rounded-sm bg-transparent leading-none text-muted-foreground transition-[background-color,color,opacity] duration-200 ease-in-out peer-disabled/native-select:opacity-50 peer-data-disabled/native-select:opacity-50 motion-reduce:transition-none forced-colors:hidden [&>svg]:block [&>svg]:size-g16 [@media(hover:hover)]:peer-[:not([disabled]):not([data-disabled]):hover]/native-select:bg-muted [@media(hover:hover)]:peer-[:not([disabled]):not([data-disabled]):hover]/native-select:text-foreground',
            isList && 'hidden',
          )}
        >
          <ChevronDownIcon />
        </span>
      </span>
    );
  },
);

export { NativeSelect };