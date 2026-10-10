import * as React from 'react';
import { Button as ModuixButton } from '@moduix/react-tailwind/button';
import { cn } from './utils';

export type ButtonVariant = 'default' | 'destructive' | 'destructive-outline' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'sm' | 'md' | 'lg' | 'icon';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
}
/** Links and legacy dialog actions share the same component recipe. */
export function buttonVariants(variant: ButtonVariant = 'default', size: ButtonSize = 'default', className?: string) {
  return cn('ds-button ui-button', `ds-button-${variant}`, `ds-button-${size === 'default' || size === 'icon' ? 'md' : size}`, size === 'icon' && 'ds-button-icon', className);
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', iconOnly = false, type, ...props }, ref) => (
    <ModuixButton ref={ref} type={type ?? 'button'} variant={variant} size={size === 'icon' || iconOnly ? 'icon-md' : size === 'default' ? 'md' : size}
      data-button-size={size} className={buttonVariants(variant, size, cn(iconOnly && 'ds-button-icon', className))} {...props} />
  ),
);
Button.displayName = 'Button';
