import * as React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import {
  Combobox, ComboboxContent, ComboboxControl, ComboboxEmpty, ComboboxInput, ComboboxOption, ComboboxPositioner,
  ComboboxRootProvider, useCombobox, useFilter, useListCollection,
} from '@legalio/ui-components/combobox';
import {
  TagsInputClearTrigger, TagsInputControl, TagsInputHiddenInput, TagsInputInput, TagsInputItems, TagsInputLabel,
  TagsInputRootProvider, useTagsInput,
} from '@legalio/ui-components/tags-input';

function useSortedOptions(options: readonly string[]) {
  const { language } = useLanguage();
  const locale = language === 'ZH' ? 'zh-CN' : language === 'ID' ? 'id' : 'en';
  return React.useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    return Array.from(new Set(options)).sort((a, b) => collator.compare(a, b));
  }, [options, locale]);
}

/** Free-text moduix Combobox that suggests known values but accepts any typed value. */
export function SuggestInput({ id, value, onValueChange, options, placeholder, emptyText, className, ...aria }: {
  id?: string; value: string; onValueChange: (value: string) => void; options: readonly string[];
  placeholder?: string; emptyText?: string; className?: string;
  'aria-describedby'?: string; 'aria-label'?: string; 'aria-invalid'?: boolean;
}) {
  const sorted = useSortedOptions(options);
  const { contains } = useFilter({ sensitivity: 'base' });
  const { collection, filter, set } = useListCollection({ initialItems: sorted, filter: contains });
  React.useEffect(() => { set(sorted); }, [sorted, set]);
  return (
    <Combobox collection={collection} allowCustomValue inputValue={value} openOnClick className={className}
      ids={id ? { input: id } : undefined}
      onInputValueChange={details => { onValueChange(details.inputValue); filter(details.inputValue); }}
      onValueChange={details => { if (details.value[0] !== undefined) onValueChange(details.value[0]); }}>
      <ComboboxControl>
        <ComboboxInput placeholder={placeholder} {...aria} />
      </ComboboxControl>
      <ComboboxPositioner>
        <ComboboxContent>
          {emptyText && <ComboboxEmpty>{emptyText}</ComboboxEmpty>}
          {collection.items.map(item => <ComboboxOption key={item} item={item}>{item}</ComboboxOption>)}
        </ComboboxContent>
      </ComboboxPositioner>
    </Combobox>
  );
}

/** moduix TagsInput composed with Combobox (moduix "Tags Input with Combobox" pattern): known tags are suggested, custom tags allowed. */
export function SuggestTagsInput({ id, label, value, onValueChange, options, placeholder, clearLabel, className, controlClassName }: {
  className?: string; controlClassName?: string; id?: string; label: React.ReactNode; value: string[]; onValueChange: (value: string[]) => void;
  options: readonly string[]; placeholder?: string; clearLabel: string;
}) {
  const sorted = useSortedOptions(options);
  const { contains } = useFilter({ sensitivity: 'base' });
  const { collection, filter, set } = useListCollection({ initialItems: sorted, filter: contains });
  React.useEffect(() => { set(sorted); }, [sorted, set]);
  const baseId = React.useId();
  const inputId = id || `${baseId}-input`;
  const controlId = `${baseId}-control`;
  const tagsInput = useTagsInput({
    ids: { input: inputId, control: controlId }, value, addOnPaste: true, delimiter: ',',
    onValueChange: details => onValueChange(details.value),
  });
  const combobox = useCombobox({
    ids: { input: inputId, control: controlId }, collection, value: [], allowCustomValue: true, selectionBehavior: 'clear',
    onInputValueChange: details => filter(details.inputValue),
    onValueChange: details => { if (details.value[0]) tagsInput.addValue(details.value[0]); },
  });
  return (
    <ComboboxRootProvider value={combobox}>
      <TagsInputRootProvider value={tagsInput} className={className}>
        <TagsInputLabel>{label}</TagsInputLabel>
        <TagsInputControl className={controlClassName}>
          <TagsInputItems />
          <ComboboxInput asChild><TagsInputInput placeholder={placeholder} /></ComboboxInput>
          <TagsInputClearTrigger aria-label={clearLabel} />
        </TagsInputControl>
        <TagsInputHiddenInput />
      </TagsInputRootProvider>
      <ComboboxPositioner>
        <ComboboxContent>
          {collection.items.map(item => <ComboboxOption key={item} item={item}>{item}</ComboboxOption>)}
        </ComboboxContent>
      </ComboboxPositioner>
    </ComboboxRootProvider>
  );
}
