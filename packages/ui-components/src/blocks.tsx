import React from 'react';
import { Badge } from './badge';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from './card';
import { Avatar, AvatarFallback } from './avatar';
import { Heading } from './heading';
import { Field, FieldErrorText, FieldHelperText, FieldLabel } from './field';
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
      <CardHeader className="items-center pb-g21">
        <CardTitle asChild className="text-lg"><h2>{title}</h2></CardTitle>
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
      <CardHeader className="items-center pb-g13">
        <div className="col-start-1 flex min-w-0 items-center gap-g13">
          <span className="inline-flex size-g34 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&>svg]:size-g16" aria-hidden="true">{icon}</span>
          <div className="min-w-0">
            <CardTitle asChild className="text-lg"><h2>{title}</h2></CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </div>
        {actions && <CardAction className="self-center">{actions}</CardAction>}
      </CardHeader>
      {children}
    </Card>
  );
}

const TABLE_CARD_TONES = {
  danger: 'border-status-danger-border bg-status-danger-soft text-status-danger',
  warning: 'border-status-warning-border bg-status-warning-soft text-status-warning',
  info: 'border-status-info-border bg-status-info-soft text-status-info',
} as const;

/** Header of a Card that holds a Table: a 34 tinted icon tile and a 16/600 title, padded g21 like the table's first and last cells. */
export function TableCardHeader({ icon, tone, title, className }: {
  icon: React.ReactNode;
  tone: keyof typeof TABLE_CARD_TONES;
  title: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-g13 border-b border-border px-g21 pt-g21 pb-g13', className)}>
      <Avatar size="md" className={cn('shrink-0 rounded-md border', TABLE_CARD_TONES[tone])} aria-hidden="true">
        <AvatarFallback className="bg-transparent text-inherit [&>svg]:size-g21">{icon}</AvatarFallback>
      </Avatar>
      <Heading as="h3" size="sm" weight="semibold">{title}</Heading>
    </div>
  );
}

/** One numbered card of a dialog form: a 26 step tile and a 16/600 title, then the fields. */
export function FormSection({ step, title, children }: { step: number; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="gap-g13 p-g13">
      <div className="flex items-center gap-g8">
        <Badge tone="neutral" className="size-g26 justify-center rounded-full p-0 font-semibold">{step}</Badge>
        <Heading as="h3" size="sm" weight="semibold">{title}</Heading>
      </div>
      {children}
    </Card>
  );
}
