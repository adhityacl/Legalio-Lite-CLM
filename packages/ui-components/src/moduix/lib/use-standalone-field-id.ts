import { useFieldContext } from '@ark-ui/react/field';
import { useId } from 'react';

/**
 * Inside a Field, Ark wires the control's id to its label, so we leave it alone.
 * A standalone control (search box, table filter) has no id; browsers then warn
 * that autofill cannot identify it. Give it a stable unique id in that case.
 */
export function useStandaloneFieldId(id: string | undefined, name: string | undefined): string | undefined {
  const field = useFieldContext();
  const fallback = useId();
  if (id || name || field) return id;
  return `field-${fallback.replace(/:/g, '')}`;
}
