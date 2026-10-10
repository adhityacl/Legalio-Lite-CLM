# Document calendar

The Calendar View tab in Document Structure uses the existing tenant-scoped `/api/init-data` React Query cache. Document permissions and department visibility are checked before events are created. The commercial-documents module setting also controls whether commercial document events appear. Event clicks navigate through the application's existing navigation hook and open its existing read-only detail modal.

## Date mapping

- Start: `tanggal_mulai` on contracts and commercial documents.
- End: `tanggal_berakhir`, falling back to the legacy `tanggal_selesai` field. Indefinite dates (`9999`) are omitted.
- Cancellation notice: end date minus `notice_period_hari`, only for `Termination` or `Both` notice rules and a positive whole-day notice period.
- Automatic renewal: the day after the current contract end, explicitly identified as a projected automatic renewal in the event tooltip and accessible label. Terminated contracts have no projected renewal.
- Termination: the explicit `termination_date` on contracts whose `lifecycle_mode` is `terminated`. Scheduled future terminations appear on that date; a legacy terminated status without a date does not produce a fabricated event. Task events remain supported by the model, but the workspace has no task service.

Business dates are constructed in local time, with today's date supplied by the existing tenant-timezone helper. Labels use the existing ID/EN/ZH translation catalog and active formatting locale. No UTC parsing is used for calendar days.

## Backend follow-up

The current endpoint returns all accessible workspace records and has no range parameter. Grouping and range navigation therefore run in memory, without a separate fetch or duplicate cache. `DocumentCalendar.onRangeChange(start, end)` is available for a future date-range service. A backend extension should apply tenant and permission checks before selecting milestones, return explicit renewal/termination dates and task due dates, and include notice deadlines whose source documents end outside the requested range. This is a separate backend change, not part of the UI tab.

## Example and validation

`src/features/calendar/DocumentCalendar.example.tsx` demonstrates 18 events, all six types, a month with more than four events and a day with more than three. Example records are never added to live workspace data. Render the example inside the existing language and tenant-settings providers.

Unit tests cover date validation, local date semantics, notice calculations, access restrictions, grouping, month boundaries and task presentation. Browser fixtures exercise the real tab, filters, navigation, overflow, document details, loading/retry, responsive layouts and themes without touching the application database.
