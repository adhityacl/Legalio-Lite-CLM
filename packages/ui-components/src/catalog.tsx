import React, { useState } from 'react';
import { Button } from './button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './card';
import { Input } from './input';
import { Badge } from './badge';
import { Alert, AlertDescription } from './alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
import { ModalFrame, ModalTitle } from './dialog';
import { PageHeader, FormField, TableFrame } from './blocks';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from './table';
import { Skeleton } from './skeleton';

/** A live reference for component contracts; samples never call application APIs. */
export function DesignSystemCatalog() {
  const [tab, setTab] = useState('components');
  const [dialog, setDialog] = useState(false);
  return <div className="ds-page">
    <PageHeader title="Design System" description="Legalio · Moduix · Ark UI" />
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Design system sections"><TabsTrigger value="components">Components</TabsTrigger><TabsTrigger value="blocks">Blocks</TabsTrigger></TabsList>
      <TabsContent value="components" className="ds-page">
        <Card><CardHeader><CardTitle>Actions</CardTitle><CardDescription>Variants, sizes, disabled and keyboard focus states</CardDescription></CardHeader><CardContent className="ds-toolbar">
          {(['default', 'outline', 'secondary', 'ghost', 'link', 'destructive', 'destructive-outline'] as const).map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}
          <Button size="sm">Small</Button><Button size="lg">Large</Button><Button disabled>Disabled</Button>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Fields</CardTitle></CardHeader><CardContent className="ds-page">
          <FormField id="catalog-name" label="Name" help="Visible labels and helper text"><Input id="catalog-name" aria-describedby="catalog-name-help" placeholder="Example name" /></FormField>
          <FormField id="catalog-invalid" label="Invalid field"><Input id="catalog-invalid" aria-invalid="true" aria-describedby="catalog-invalid-help" defaultValue="Invalid value" /><p id="catalog-invalid-help" className="ds-field-error">Check this value.</p></FormField>
          <FormField id="catalog-disabled" label="Disabled field"><Input id="catalog-disabled" disabled defaultValue="Unavailable" /></FormField>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Status & feedback</CardTitle></CardHeader><CardContent className="ds-page"><div className="ds-toolbar">
          {(['success', 'warning', 'danger', 'info', 'purple', 'neutral'] as const).map(variant => <Badge key={variant} variant={variant}>{variant}</Badge>)}
        </div>{(['default', 'success', 'warning', 'destructive'] as const).map(variant => <Alert key={variant} variant={variant} role="status"><AlertDescription>{variant} feedback</AlertDescription></Alert>)}
          <Skeleton className="h-8 w-full" />
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Overlays</CardTitle></CardHeader><CardContent><Button variant="outline" onClick={() => setDialog(true)}>Open example dialog</Button></CardContent></Card>
      </TabsContent>
      <TabsContent value="blocks" className="ds-page">
        <Card><CardHeader><CardTitle>Aligned controls</CardTitle><CardDescription>One outline, radius and height for adjacent fields and actions</CardDescription></CardHeader><CardContent className="ds-toolbar" data-testid="aligned-controls"><Input aria-label="Filter example" placeholder="Filter records" /><select className="ds-input" aria-label="Status example"><option>All statuses</option></select><Button variant="outline">Filter</Button><Button>Apply filter</Button></CardContent></Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ds-grid" data-testid="aligned-panels"><Card><CardHeader><CardTitle>First panel</CardTitle></CardHeader><CardContent>Short content</CardContent></Card><Card><CardHeader><CardTitle>Second panel</CardTitle></CardHeader><CardContent>Content can wrap onto several lines while both panels share the height of the same grid row.</CardContent></Card></div>
        <Card><CardContent><PageHeader title="Page header" description="Shared heading, description and responsive action toolbar" actions={<><Button variant="outline">Secondary action</Button><Button>Primary action</Button></>} /></CardContent></Card>
        <TableFrame><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Example record</TableCell><TableCell><Badge variant="success">Active</Badge></TableCell><TableCell><Button variant="outline" size="sm">View</Button></TableCell></TableRow></TableBody></Table></TableFrame>
        <TableFrame><Table><TableBody><TableRow><TableCell colSpan={3} className="ds-table-state">No records yet.</TableCell></TableRow></TableBody></Table></TableFrame>
      </TabsContent>
    </Tabs>
    {dialog && <ModalFrame onClose={() => setDialog(false)} data-size="sm"><div className="ds-form-body"><ModalTitle>Example dialog</ModalTitle><p className="ds-muted">Escape closes the dialog and restores focus to its trigger.</p><FormField id="catalog-dialog-input" label="Example field"><Input id="catalog-dialog-input" /></FormField><div className="ds-form-actions"><Button variant="outline" onClick={() => setDialog(false)}>Close</Button></div></div></ModalFrame>}
  </div>;
}
