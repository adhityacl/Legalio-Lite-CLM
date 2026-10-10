export interface ContractLifecycleFields {
  lifecycle_mode?: 'normal' | 'terminated';
  termination_date?: string | null;
  termination_reason?: string;
  termination_document?: { fileName: string; url: string };
}
