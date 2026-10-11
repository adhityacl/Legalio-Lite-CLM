import { cva } from 'class-variance-authority';

export const menuPositionerVariants = cva(
  'z-[var(--z-index)] w-[var(--positioner-width,auto)] max-w-[var(--available-width)] outline-0',
);

export const menuContentVariants = cva(
  'relative z-[calc(var(--moduix-z-popup)+var(--layer-index,0))] flex max-w-[min(var(--spacing-g377),var(--available-width,100vw))] min-w-[min(max(var(--reference-width,0px),var(--spacing-g233)),var(--available-width,100vw))] origin-[var(--transform-origin)] flex-col overflow-visible rounded-md bg-popover py-g5 text-popover-foreground shadow-lg outline-1 outline-border [--arrow-background:var(--color-popover)] [--arrow-size:var(--spacing-g8)] data-[state=closed]:animate-moduix-menu-closed data-[state=open]:animate-moduix-menu-open motion-reduce:[animation-delay:0ms] motion-reduce:[animation-duration:1ms]',
);