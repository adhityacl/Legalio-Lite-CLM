import { Field as FieldPrimitive } from '@ark-ui/react/field';
import { cva } from 'class-variance-authority';
import type { ComponentProps, ComponentRef } from 'react';
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { useStandaloneFieldId } from '../../lib/use-standalone-field-id';

const inputVariants = cva(
  'w-full max-w-none rounded-md border border-border bg-background px-g13 py-g5 text-sm leading-5 text-foreground outline-1 -outline-offset-1 outline-transparent transition-[border-color,outline-color,opacity] duration-200 ease-in-out placeholder:text-muted-foreground focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [[data-slot=input-group-root]:has([data-slot=input-root]:is([data-disabled],:disabled))_&]:opacity-100 [:is([data-slot=fieldset-root][data-disabled],[data-slot=fieldset-root-provider][data-disabled])_&]:opacity-100 data-disabled:pointer-events-none data-disabled:opacity-50 data-invalid:border-destructive data-invalid:focus-visible:outline-destructive aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive motion-reduce:transition-none file:me-g13 file:rounded-md file:border file:border-primary file:bg-primary file:px-g8 file:py-g2 file:font-medium file:text-primary-foreground file:transition-colors file:duration-200 file:ease-in-out file:cursor-pointer [@media(hover:hover)]:file:hover:bg-foreground [[data-slot=field-root][data-disabled]_&]:opacity-100 [[data-slot=field-root-provider][data-disabled]_&]:opacity-100',
  {
    variants: {
      size: {
        xs: 'min-h-control-xs px-g8 py-0 text-xs leading-4',
        sm: 'min-h-control-sm px-g8 py-0 text-sm leading-5',
        md: 'min-h-control-md',
        lg: 'min-h-control-lg px-g16 py-0 text-md leading-6',
        xl: 'min-h-control-xl px-g16 py-0 text-lg leading-7',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

const Input = forwardRef<
  ComponentRef<typeof FieldPrimitive.Input>,
  Omit<ComponentProps<typeof FieldPrimitive.Input>, 'size'> & {
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    htmlSize?: ComponentProps<'input'>['size'];
  }
>(function Input({ className, htmlSize, size = 'md', ...props }, ref) {
  const id = useStandaloneFieldId(props.id, props.name);
  return (
    <FieldPrimitive.Input
      {...props}
      {...(id ? { id } : {})}
      ref={ref}
      data-scope="field"
      data-part="input"
      data-slot="input-root"
      data-size={size}
      data-html-size={htmlSize === undefined ? undefined : ''}
      className={cn(
        inputVariants({ size }),
        htmlSize === undefined ? undefined : 'w-auto',
        className,
      )}
      size={htmlSize}
    />
  );
});

export { Input };