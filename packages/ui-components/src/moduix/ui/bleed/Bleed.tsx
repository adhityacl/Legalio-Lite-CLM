import type { HTMLArkProps } from '@ark-ui/react/factory';
import { ark } from '@ark-ui/react/factory';
import { cva } from 'class-variance-authority';
import { forwardRef, type ForwardedRef } from 'react';
import { cn } from '../../lib/cn';

type BleedAmount = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type BleedInline = BleedAmount | 'full';

const bleedVariants = cva('', {
  variants: {
    inline: {
      none: null,
      xs: '-mx-g5',
      sm: '-mx-g8',
      md: '-mx-g13',
      lg: '-mx-g16',
      xl: '-mx-g26',
      full: 'mx-[calc(50%_-_50vi)] [inline-size:100vi]',
    },
    block: {
      none: null,
      xs: '-my-g5',
      sm: '-my-g8',
      md: '-my-g13',
      lg: '-my-g16',
      xl: '-my-g26',
    },
  },
  defaultVariants: {
    inline: 'full',
    block: 'none',
  },
});

const Bleed = forwardRef<
  HTMLElement,
  HTMLArkProps<'div'> & {
    inline?: BleedInline;
    block?: BleedAmount;
  }
>(function Bleed({ inline = 'full', block = 'none', className, ...props }, ref) {
  return (
    <ark.div
      ref={ref as ForwardedRef<HTMLDivElement>}
      {...props}
      data-scope="bleed"
      data-part="root"
      data-slot="bleed-root"
      data-inline={inline}
      data-block={block}
      className={cn(bleedVariants({ inline, block }), className)}
    />
  );
});

export { Bleed };