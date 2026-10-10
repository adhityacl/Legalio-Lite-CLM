import { Table as ModuixTable, TableHeader as ModuixHeader, TableBody as ModuixBody, TableRow as ModuixRow, TableColumnHeader as ModuixHead, TableCell as ModuixCell } from '@moduix/react-tailwind/table';
import * as React from "react"
import { cn } from "./utils"

/** shadcn-standard table primitives (token driven). */
export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="ds-table-surface relative w-full overflow-x-auto">
      <ModuixTable ref={ref} className={cn("ds-table w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
)
Table.displayName = "Table"

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <ModuixHeader ref={ref} className={cn("[&_tr]:border-b [&_tr]:border-[var(--border)]", className)} {...props} />
)
TableHeader.displayName = "TableHeader"

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <ModuixBody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
)
TableBody.displayName = "TableBody"

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <ModuixRow ref={ref} className={cn("border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)]/50", className)} {...props} />
  )
)
TableRow.displayName = "TableRow"

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <ModuixHead ref={ref} className={cn("h-10 px-2 text-left align-middle text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]", className)} {...props} />
  )
)
TableHead.displayName = "TableHead"

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <ModuixCell ref={ref} className={cn("p-2 align-middle", className)} {...props} />
)
TableCell.displayName = "TableCell"

export const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-[var(--muted-foreground)]", className)} {...props} />
  )
)
TableCaption.displayName = "TableCaption"
