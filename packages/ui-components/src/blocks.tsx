import React from 'react';
import { cn } from './utils';
export function PageHeader({ title, description, icon, actions }: { title: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode }) {
  return <header className="ds-page-header"><div><h2 className="ds-page-heading">{icon}{title}</h2>{description && <p className="ds-page-description">{description}</p>}</div>{actions && <div className="ds-toolbar">{actions}</div>}</header>;
}
export function FormField({ id, label, help, children }: { id: string; label: React.ReactNode; help?: React.ReactNode; children: React.ReactNode }) {
  return <div className="ds-field"><label htmlFor={id} className="ds-field-label">{label}</label>{children}{help && <p id={`${id}-help`} className="ds-field-help">{help}</p>}</div>;
}
export function TableFrame({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ds-table-frame', className)} {...props} />;
}
