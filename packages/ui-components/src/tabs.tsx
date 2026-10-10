import * as React from 'react';
import { Tabs as ModuixTabs, TabsList, TabsTrigger, TabsContent } from '@moduix/react-tailwind/tabs';
export { TabsList, TabsTrigger, TabsContent };
export function Tabs({ value, onValueChange, ...props }: { value: string; onValueChange: (value: string) => void; className?: string; children: React.ReactNode; id?: string }) {
  return <ModuixTabs value={value} onValueChange={details => onValueChange(details.value)} lazyMount unmountOnExit {...props} />;
}
