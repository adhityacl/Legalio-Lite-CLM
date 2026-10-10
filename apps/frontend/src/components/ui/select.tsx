import { AlphabeticalSelect } from './alphabetical-select'
import * as React from "react"
import { cn } from "@legalio/ui-components/utils"

/** Native select styled with the shadcn token contract (dependency-free). */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <AlphabeticalSelect
      ref={ref}
      className={cn(
        "ds-input flex w-full appearance-none pr-8",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </AlphabeticalSelect>
  </div>
))
Select.displayName = "Select"

export { Select }
