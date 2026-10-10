import * as React from 'react';
import { Input as ModuixInput } from '@moduix/react-tailwind/input';
import { cn } from './utils';
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, size, ...props }, ref) => <ModuixInput ref={ref} htmlSize={size} size="lg" className={cn('ds-input', className)} {...props} />);
Input.displayName = 'Input';
/** Class for native fields that cannot render <Input> (select, textarea, custom wrappers). */
export const fieldControlClass = 'ds-input w-full';
