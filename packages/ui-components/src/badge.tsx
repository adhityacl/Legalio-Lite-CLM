import { Badge as ModuixBadge } from '@moduix/react-tailwind/badge';
import * as React from "react";
import { cn } from "./utils";

export type BadgeVariant =
  | "default"
  | "success"
  | "secondary"
  | "destructive"
  | "danger"
  | "warning"
  | "outline"
  | "purple"
  | "info"
  | "neutral";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  className?: string;
  children?: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
}

export function getStatusBadgeClass(status: string): string {
  const s = (status || "").toLowerCase().trim();
  
  // Success / Aktif / Lengkap / Recommended / Berjalan / Signed / BHI
  if (
    s === "aktif" ||
    s === "active" ||
    s === "lengkap" ||
    s === "complete" ||
    s === "available" ||
    s === "recommended" ||
    s === "berjalan" ||
    s === "signed" ||
    s === "success" ||
    s === "excellent" ||
    s === "sangat baik" ||
    s === "bhi" ||
    s === "never"
  ) {
    return "ds-status-success";
  }

  // Warning / Akan Berakhir / Belum Lengkap / Recommended with notes / Review / Fair / Moderate / Rare / Sisa Waktu
  if (
    s === "akan berakhir" ||
    s === "expiring" ||
    s === "warning" ||
    s === "belum lengkap" ||
    s === "incomplete" ||
    s === "missing" ||
    s === "recommended with notes" ||
    s === "review" ||
    s === "fair" ||
    s === "baik" ||
    s === "moderate" ||
    s === "rare" ||
    s === "pending" ||
    s.includes("hari lagi") ||
    s.includes("days left")
  ) {
    return "ds-status-warning";
  }

  // Danger / Expired / Kadaluarsa / Terminated / Not Recommended / Inactive / Ditolak / Frequent
  if (
    s === "expired" ||
    s === "kadaluarsa" ||
    s === "terminated" ||
    s === "not recommended" ||
    s === "inactive" ||
    s === "nonaktif" ||
    s === "ditolak" ||
    s === "danger" ||
    s === "kurang baik" ||
    s === "frequent" ||
    s === "expensive" ||
    s === "delete"
  ) {
    return "ds-status-danger";
  }

  // Legal / Good / Info / Selesai / BHA / Create / IO
  if (
    s === "legal" ||
    s === "good" ||
    s === "info" ||
    s === "selesai" ||
    s === "cheap" ||
    s === "bha" ||
    s === "create" ||
    s === "io" ||
    s === "contract"
  ) {
    return "ds-status-info";
  }

  // Admin / Addendum / Purple
  if (
    s === "admin" ||
    s === "addendum" ||
    s === "auth" ||
    s === "add_user"
  ) {
    return "ds-status-special";
  }

  // Finance / Cyan
  if (s === "finance" || s === "spending" || s === "invoice") {
    return "ds-status-finance";
  }

  // Default / Neutral / Draft / Module / Update
  return "ds-status-neutral";
}

function Badge({ className, variant = "default", size = "md", children, ...props }: BadgeProps) {
  let variantClass = "";
  switch (variant) {
    case "success":
    case "default":
      variantClass = "ds-status-success";
      break;
    case "warning":
      variantClass = "ds-status-warning";
      break;
    case "destructive":
    case "danger":
      variantClass = "ds-status-danger";
      break;
    case "info":
      variantClass = "ds-status-info";
      break;
    case "purple":
      variantClass = "ds-status-special";
      break;
    case "secondary":
    case "neutral":
    case "outline":
    default:
      variantClass = "ds-status-neutral";
      break;
  }

  return (
    <ModuixBadge variant="outline"
      className={cn(
        "ds-badge",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-0.5 text-xs",
        variantClass,
        className
      )}
      {...props}
    >
      {children}
    </ModuixBadge>
  );
}

export { Badge };

