import * as React from 'react';
import { Card as ModuixCard, CardHeader as ModuixHeader, CardBody as ModuixBody, CardFooter as ModuixFooter, CardTitle as ModuixTitle, CardDescription as ModuixDescription } from '@moduix/react-tailwind/card';
import { cn } from './utils';
export const Card = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof ModuixCard>>(({ className, ...props }, ref) => <ModuixCard ref={ref} className={cn('ds-card', className)} {...props} />);
export const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof ModuixHeader>>(({ className, ...props }, ref) => <ModuixHeader ref={ref} className={cn('ds-card-header', className)} {...props} />);
export const CardContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof ModuixBody>>(({ className, ...props }, ref) => <ModuixBody ref={ref} className={cn('ds-card-body', className)} {...props} />);
export const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof ModuixFooter>>(({ className, ...props }, ref) => <ModuixFooter ref={ref} className={cn('ds-card-footer', className)} {...props} />);
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<typeof ModuixTitle>>(({ className, ...props }, ref) => <ModuixTitle ref={ref} className={cn('ds-card-title', className)} {...props} />);
export const CardDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<typeof ModuixDescription>>(({ className, ...props }, ref) => <ModuixDescription ref={ref} className={cn('ds-muted', className)} {...props} />);
