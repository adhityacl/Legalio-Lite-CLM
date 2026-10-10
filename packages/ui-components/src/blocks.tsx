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
