import type { HTMLArkProps } from '@ark-ui/react/factory';
import { ark } from '@ark-ui/react/factory';
import { cva } from 'class-variance-authority';
import type { ComponentRef } from 'react';
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

type ContainerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
type ContainerGutter = 'none' | 'sm' | 'md' | 'lg';

const containerVariants = cva('w-full min-w-0 mx-auto', {
  variants: {
    size: {
      xs: 'max-w-[calc(var(--spacing-g610)_+_(clamp(var(--spacing-g16),4vw,var(--spacing-g34))*2))]',
      sm: 'max-w-[calc(var(--spacing-g987)_+_(clamp(var(--spacing-g16),4vw,var(--spacing-g34))*2))]',
      md: 'max-w-[calc(var(--spacing-g987)_+_(clamp(var(--spacing-g16),4vw,var(--spacing-g34))*2))]',
      lg: 'max-w-[calc(var(--spacing-g1597)_+_(clamp(var(--spacing-g16),4vw,var(--spacing-g34))*2))]',
      xl: 'max-w-[calc(var(--spacing-g1597)_+_(clamp(var(--spacing-g16),4vw,var(--spacing-g34))*2))]',
      full: 'max-w-none',
    },
    gutter: {
      none: 'px-0',
      sm: 'px-[clamp(var(--spacing-g13),3vw,var(--spacing-g21))]',
      md: 'px-[clamp(var(--spacing-g16),4vw,var(--spacing-g34))]',
      lg: 'px-[clamp(var(--spacing-g21),5vw,var(--spacing-g42))]',
    },
  },
  compoundVariants: [
    { size: 'xs', gutter: 'none', class: 'max-w-g610' },
    { size: 'xs', gutter: 'sm', class: 'max-w-[calc(var(--spacing-g610)_+_(clamp(var(--spacing-g13),3vw,var(--spacing-g21))*2))]' },
    { size: 'xs', gutter: 'lg', class: 'max-w-[calc(var(--spacing-g610)_+_(clamp(var(--spacing-g21),5vw,var(--spacing-g42))*2))]' },
    { size: 'sm', gutter: 'none', class: 'max-w-g610' },
    { size: 'sm', gutter: 'sm', class: 'max-w-[calc(var(--spacing-g987)_+_(clamp(var(--spacing-g13),3vw,var(--spacing-g21))*2))]' },
    { size: 'sm', gutter: 'lg', class: 'max-w-[calc(var(--spacing-g987)_+_(clamp(var(--spacing-g21),5vw,var(--spacing-g42))*2))]' },
    { size: 'md', gutter: 'none', class: 'max-w-g987' },
    { size: 'md', gutter: 'sm', class: 'max-w-[calc(var(--spacing-g987)_+_(clamp(var(--spacing-g13),3vw,var(--spacing-g21))*2))]' },
    { size: 'md', gutter: 'lg', class: 'max-w-[calc(var(--spacing-g987)_+_(clamp(var(--spacing-g21),5vw,var(--spacing-g42))*2))]' },
    { size: 'lg', gutter: 'none', class: 'max-w-g987' },
    { size: 'lg', gutter: 'sm', class: 'max-w-[calc(var(--spacing-g1597)_+_(clamp(var(--spacing-g13),3vw,var(--spacing-g21))*2))]' },
    { size: 'lg', gutter: 'lg', class: 'max-w-[calc(var(--spacing-g1597)_+_(clamp(var(--spacing-g21),5vw,var(--spacing-g42))*2))]' },
    { size: 'xl', gutter: 'none', class: 'max-w-g1597' },
    { size: 'xl', gutter: 'sm', class: 'max-w-[calc(var(--spacing-g1597)_+_(clamp(var(--spacing-g13),3vw,var(--spacing-g21))*2))]' },
    { size: 'xl', gutter: 'lg', class: 'max-w-[calc(var(--spacing-g1597)_+_(clamp(var(--spacing-g21),5vw,var(--spacing-g42))*2))]' },
  ],
  defaultVariants: {
    size: 'lg',
    gutter: 'md',
  },
});

type ContainerProps = HTMLArkProps<'div'> & {
  size?: ContainerSize;
  gutter?: ContainerGutter;
};

const Container = forwardRef<ComponentRef<typeof ark.div>, ContainerProps>(function Container(
  { size = 'lg', gutter = 'md', className, ...props },
  ref,
) {
  return (
    <ark.div
      {...props}
      ref={ref}
      data-scope="container"
      data-part="root"
      data-slot="container-root"
      data-size={size}
      data-gutter={gutter}
      className={cn(containerVariants({ size, gutter }), className)}
    />
  );
});

export { Container };