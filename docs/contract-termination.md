# Contract endings

Edit Contract retains two choices: Normal and Terminated. Normal derives Active, Expiring or Expired from the current end date, auto-renewal and tenant policy. Selecting Terminated reveals Termination Date, Termination Document and Reason Note. An expired Normal contract reveals a disabled End Date copied from Contract End Date, plus Termination Document and Reason Note.

Contract POST/PUT accept `lifecycle_mode` (`normal` or `terminated`), `termination_date` (ISO business date or null), `termination_reason`, and an optional `termination_document_file` containing `fileName` and a base64 data URL. Dates are validated against the contract period. Changing back to Normal clears the effective termination date while preserving saved evidence and reason. Notice upload and reason are optional; termination date is required for new explicit termination actions.

The API stores the resulting `termination_document: { fileName, url }`, never the base64 upload. A replacement notice does not replace the original contract file. Evidence accepts PDF/DOC/DOCX up to 10 MB, with validated document headers. It uses the existing Google Drive upload mechanism or the authenticated, tenant-scoped local upload route. Editing without an upload preserves the saved notice.

Future termination dates preserve Active/Expiring until the effective date, then become Terminated. Selecting Terminated disables auto-renewal. Status is derived on saves, existing lifecycle checks and workspace/contract reads. Legacy Terminated records with no date remain supported, without inventing a date. The calendar uses only explicit termination dates, including scheduled ones, and keeps the original contractual end date separate.

Existing JSON payload storage persists the new fields without a destructive database migration. ID, EN and ZH labels use the existing translation catalogs. API errors leave the editor open and retain entered values.
