import React from 'react';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@moduix/react-tailwind/card';
import { Field, FieldErrorText, FieldHelperText, FieldLabel } from '@moduix/react-tailwind/field';
import { cn } from './utils';

/** Page header block: one moduix Card per page, title on the start side, page actions on the end side. */
export function PageHeader({ title, description, actions, className }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="items-center pb-6">
        <CardTitle asChild className="text-xl"><h2>{title}</h2></CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {actions && <CardAction className="flex-wrap self-center">{actions}</CardAction>}
      </CardHeader>
    </Card>
  );
}

/** Labelled form field block; the control is passed as children and inherits the field context. */
export function FormField({ label, help, error, required, invalid, className, children }: {
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  invalid?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Field required={required} invalid={invalid ?? Boolean(error)} className={cn('min-w-0', className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {help && <FieldHelperText>{help}</FieldHelperText>}
      {error && <FieldErrorText>{error}</FieldErrorText>}
    </Field>
  );
}

/** Context header block: an icon, title and actions above an optional row (usually Tabs). */
export function ContextHeader({ icon, title, description, actions, children, className }: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="items-center pb-4">
        <div className="col-start-1 flex min-w-0 items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&>svg]:size-5" aria-hidden="true">{icon}</span>
          <div className="min-w-0">
            <CardTitle asChild className="text-xl"><h2>{title}</h2></CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </div>
        {actions && <CardAction className="self-center">{actions}</CardAction>}
      </CardHeader>
      {children}
    </Card>
  );
}
