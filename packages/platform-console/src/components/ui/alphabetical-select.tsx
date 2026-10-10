import * as React from 'react';
import { useLanguage } from '../../context/LanguageContext';

import { NativeSelect } from '@legalio/ui-components/native-select';
type OptionProps = {
  children?: React.ReactNode;
  value?: string | number | readonly string[];
  label?: string;
};

function optionText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (React.isValidElement<OptionProps>(node)) return optionText(node.props.children);
  return React.Children.toArray(node).map(optionText).join('');
}

/** Sort visible labels without changing option values or the source data. */
function alphabeticalOptions(children: React.ReactNode, locale: string): React.ReactNode[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const options = React.Children.toArray(children).flatMap(node => {
    if (React.isValidElement<OptionProps>(node) && node.type === React.Fragment) {
      return alphabeticalOptions(node.props.children, locale);
    }
    return [node];
  });
  const priority = (node: React.ReactNode) => {
    if (!React.isValidElement<OptionProps>(node)) return 0;
    const value = String(node.props.value ?? '').toLowerCase();
    if (node.type === 'option' && (value === '' || value === 'all')) return -1;
    if (value === '__custom__') return 1;
    return 0;
  };
  const label = (node: React.ReactNode) => {
    if (!React.isValidElement<OptionProps>(node)) return optionText(node);
    return node.props.label ?? (optionText(node.props.children) || String(node.props.value ?? ''));
  };
  return options.sort((a, b) => {
    const group = priority(a) - priority(b);
    // Preserve the order of placeholders and actions within their groups.
    return group || (priority(a) === 0 ? collator.compare(label(a).trim(), label(b).trim()) : 0);
  });
}

/** moduix NativeSelect whose visible options are sorted for the active language. */
export const AlphabeticalSelect = React.forwardRef<HTMLSelectElement, React.ComponentPropsWithoutRef<typeof NativeSelect>>(
  ({ children, ...props }, ref) => {
    const { language } = useLanguage();
    const locale = language === 'ZH' ? 'zh-CN' : language === 'ID' ? 'id' : 'en';
    return <NativeSelect {...props} ref={ref}>{alphabeticalOptions(children, locale)}</NativeSelect>;
  },
);
AlphabeticalSelect.displayName = 'AlphabeticalSelect';

export function AlphabeticalDatalist({ children, ...props }: React.HTMLAttributes<HTMLDataListElement>) {
  const { language } = useLanguage();
  const locale = language === 'ZH' ? 'zh-CN' : language === 'ID' ? 'id' : 'en';
  return <datalist {...props}>{alphabeticalOptions(children, locale)}</datalist>;
}
