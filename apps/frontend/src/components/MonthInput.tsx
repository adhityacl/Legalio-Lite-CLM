import React from 'react';
import { DatePicker, DatePickerContent, DatePickerField, DatePickerPositioner, parseDate, type DateValue } from '@legalio/ui-components/date-picker';
import { GridView } from './DateInput';

export interface MonthInputProps {
  /** ISO month, YYYY-MM. */
  value: string;
  onChange: (isoMonth: string) => void;
  required?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  min?: string;
  max?: string;
  'aria-describedby'?: string;
}

const toValue = (month: string | undefined): DateValue | undefined => {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return undefined;
  try { return parseDate(`${month}-01`); } catch { return undefined; }
};
const pad = (n: number) => String(n).padStart(2, '0');

/** Month field (mm/yyyy) on the moduix DatePicker: typed entry plus month and year grids. Values stay ISO (YYYY-MM). */
export const MonthInput: React.FC<MonthInputProps> = ({ value, onChange, required, invalid, disabled, id, min, max, 'aria-describedby': describedBy }) => {
  const selected = toValue(value);
  return (
    <DatePicker
      locale="en-GB"
      minView="month"
      defaultView="month"
      ids={id ? { input: () => id } : undefined}
      required={required}
      invalid={invalid}
      disabled={disabled}
      placeholder="mm/yyyy"
      min={toValue(min)}
      max={toValue(max)}
      format={date => `${pad(date.month)}/${date.year}`}
      parse={text => {
        const match = text.trim().match(/^(\d{1,2})\/(\d{4})$/);
        return match && Number(match[1]) >= 1 && Number(match[1]) <= 12 ? toValue(`${match[2]}-${pad(Number(match[1]))}`) : undefined;
      }}
      value={selected ? [selected] : []}
      onValueChange={details => { const d = details.value[0]; onChange(d ? `${d.year}-${pad(d.month)}` : ''); }}
    >
      <DatePickerField aria-describedby={describedBy} />
      <DatePickerPositioner>
        <DatePickerContent>
          <GridView view="month" />
          <GridView view="year" />
        </DatePickerContent>
      </DatePickerPositioner>
    </DatePicker>
  );
};
