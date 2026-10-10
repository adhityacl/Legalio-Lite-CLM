import React, { useState } from 'react';
import { Button } from './button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from './card';
import { Input } from './input';
import { NativeSelect } from './native-select';
import { Badge, type StatusTone } from './badge';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from './alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { DialogBody, DialogCloseIcon, DialogFooter, DialogHeader, DialogTitle, ModalFrame } from './dialog';
import { FormField, PageHeader } from './blocks';
import { Table, TableBody, TableCell, TableColumnHeader, TableEmpty, TableHeader, TableRow, TableScrollArea } from './table';
import { Skeleton } from './skeleton';

const tones: StatusTone[] = ['success', 'warning', 'danger', 'info', 'special', 'finance', 'neutral'];

/** A live reference for the moduix components and Legalio blocks; samples never call application APIs. */
export function DesignSystemCatalog() {
  const [tab, setTab] = useState('components');
  const [dialog, setDialog] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Design System" description="Legalio on moduix (Ark UI)" />
      <Tabs value={tab} onValueChange={details => setTab(details.value)}>
        <TabsList aria-label="Design system sections">
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="blocks">Blocks</TabsTrigger>
        </TabsList>
        <TabsContent value="components" className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle><CardDescription>Variants, sizes and disabled state</CardDescription></CardHeader>
            <CardBody className="flex flex-wrap gap-2">
              {(['default', 'outline', 'secondary', 'ghost', 'link', 'destructive', 'destructive-outline'] as const).map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}
              <Button size="sm">Small</Button><Button disabled>Disabled</Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Fields</CardTitle></CardHeader>
            <CardBody className="grid gap-4">
              <FormField label="Name" help="Visible labels and helper text"><Input placeholder="Example name" /></FormField>
              <FormField label="Invalid field" error="Check this value."><Input defaultValue="Invalid value" /></FormField>
              <FormField label="Status"><NativeSelect><option>All statuses</option></NativeSelect></FormField>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Status and feedback</CardTitle></CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">{tones.map(tone => <Badge key={tone} tone={tone}>{tone}</Badge>)}</div>
              {(['info', 'success', 'warning', 'error'] as const).map(status => (
                <Alert key={status} status={status}><AlertIndicator /><AlertContent><AlertDescription>{status} feedback</AlertDescription></AlertContent></Alert>
              ))}
              <Skeleton height={32} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Overlays</CardTitle></CardHeader>
            <CardBody><Button variant="outline" onClick={() => setDialog(true)}>Open example dialog</Button></CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="blocks" className="flex flex-col gap-6">
          <PageHeader title="Page header" description="Shared title, description and actions" actions={<><Button variant="outline">Secondary action</Button><Button>Primary action</Button></>} />
          <Card>
            <CardBody className="flex flex-wrap gap-2">
              <Input aria-label="Filter example" placeholder="Filter records" className="w-60" />
              <NativeSelect aria-label="Status example" className="w-48"><option>All statuses</option></NativeSelect>
              <Button variant="outline">Filter</Button><Button>Apply filter</Button>
            </CardBody>
          </Card>
          <TableScrollArea>
            <Table variant="outline">
              <TableHeader><TableRow><TableColumnHeader>Name</TableColumnHeader><TableColumnHeader>Status</TableColumnHeader><TableColumnHeader>Actions</TableColumnHeader></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Example record</TableCell><TableCell><Badge tone="success">Active</Badge></TableCell><TableCell><Button variant="outline" size="sm">View</Button></TableCell></TableRow>
                <TableRow><TableEmpty colSpan={3}>No records yet.</TableEmpty></TableRow>
              </TableBody>
            </Table>
          </TableScrollArea>
        </TabsContent>
      </Tabs>
      {dialog && (
        <ModalFrame size="sm" onClose={() => setDialog(false)} className="p-6">
          <DialogHeader><DialogTitle>Example dialog</DialogTitle><DialogCloseIcon /></DialogHeader>
          <DialogBody><FormField label="Example field"><Input /></FormField></DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setDialog(false)}>Close</Button></DialogFooter>
        </ModalFrame>
      )}
    </div>
  );
}
