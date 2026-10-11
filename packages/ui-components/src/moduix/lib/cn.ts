import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        ...['2', '3', '5', '8', '13', '16', '21', '26', '34', '42', '55', '68', '89', '110', '144', '233', '377', '610', '987', '1597'].map((step) => `g${step}`),
        'space-xs',
        'space-sm',
        'space-md',
        'space-lg',
        'space-xl',
        'space-2xl',
        'control-xs',
        'control-sm',
        'control-md',
        'control-lg',
        'control-xl',
        'form-wide',
      ],
      text: ['md'],
      'font-weight': ['regular'],
      tracking: ['text-xs', 'text-sm'],
      ease: ['standard', 'spring', 'emphasized'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}