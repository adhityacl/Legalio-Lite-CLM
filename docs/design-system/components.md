# 🧩 Katalog Komponen `@legalio/ui-components`

Seluruh komponen UI di bawah ini berstatus **100% In-Tree & Copy-Owned** di dalam [`packages/ui-components/src/`](file:///workspaces/NEW-CLM/packages/ui-components/src/). Seluruh komponen dirancang dengan prinsip **Zero External Dependency Risk**—jika repositori luar atau paket npm dihapus, seluruh komponen UI, token gaya, animasi, dan perilakunya tetap berjalan mandiri di dalam repositori ini.

Semua komponen UI **wajib diimpor dari `@legalio/ui-components/<komponen>`**. Dilarang mengimpor library UI eksternal langsung di aplikasi konsumen (`apps/frontend`).

---

## 1. Komponen Utama & Pola Penggunaan Populer

### A. Tombol (`Button`, `SplitButton`, `CloseButton`)
```tsx
import { Button } from '@legalio/ui-components/button';
import { CloseButton } from '@legalio/ui-components/close-button';
import { SplitButton } from '@legalio/ui-components/split-button';

// Primary Action (34px)
<Button variant="default" size="md">Simpan Perubahan</Button>

// Secondary Action (34px)
<Button variant="outline" size="md">Batal</Button>

// Table Row Action (26px)
<Button variant="ghost" size="sm">Edit</Button>

// Tombol Tutup Standar
<CloseButton onClick={handleClose} />
```

### B. Input & Formulir (`Input`, `Textarea`, `Select`, `Switch`, `Checkbox`)
```tsx
import { Input } from '@legalio/ui-components/input';
import { Textarea } from '@legalio/ui-components/textarea';
import { Select } from '@legalio/ui-components/select';
import { Switch } from '@legalio/ui-components/switch';
import { Checkbox } from '@legalio/ui-components/checkbox';

<Input type="text" placeholder="Nomor Kontrak" />
<Textarea placeholder="Catatan adendum..." />
<Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
<Checkbox checked={agreed} onCheckedChange={setAgreed}>Saya menyetujui ketentuan</Checkbox>
```

### C. Badge Status (`Badge`, `Tag`)
Dilengkapi pemetaan nada status otomatis (`StatusTone`):
```tsx
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { Tag } from '@legalio/ui-components/tag';

// Otomatis mengenali kata "aktif", "expiring", "expired", dll.
<Badge tone={statusTone(contract.status)}>{contract.status}</Badge>

// Atau tentukan tone secara eksplisit:
<Badge tone="success">Aktif</Badge>
<Badge tone="warning">Akan Berakhir</Badge>
<Badge tone="danger">Kadaluarsa</Badge>
<Badge tone="finance">IDR 150.000.000</Badge>
```

### D. Modal & Dialog (`Dialog`, `ModalFrame`, `Drawer`, `FloatingPanel`)
```tsx
import { Dialog, ModalFrame } from '@legalio/ui-components/dialog';
import { Drawer } from '@legalio/ui-components/drawer';
import { FloatingPanel } from '@legalio/ui-components/floating-panel';

<ModalFrame size="md" onClose={handleClose}>
  <div className="p-6">
    <h2 className="text-lg font-semibold">Judul Modal</h2>
    {/* Body */}
  </div>
</ModalFrame>
```

### E. Alert / Pemberitahuan (`Alert`, `Toast`)
```tsx
import { Alert, AlertTitle, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';

<Alert status="warning">
  <AlertIndicator />
  <div>
    <AlertTitle>Perhatian</AlertTitle>
    <AlertDescription>Masa berlaku dokumen tinggal 30 hari.</AlertDescription>
  </div>
</Alert>
```

### F. Kartu & Tabel (`Card`, `Table`)
```tsx
import { Card, CardHeader, CardTitle, CardBody, CardFooter } from '@legalio/ui-components/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@legalio/ui-components/table';

<Card variant="outline">
  <CardHeader>
    <CardTitle>Rincian Kontrak</CardTitle>
  </CardHeader>
  <CardBody>
    {/* Isi kartu */}
  </CardBody>
</Card>
```

---

## 2. Inventaris Komponen In-Tree (Zero Dependency)

| Kategori | Daftar Komponen In-Tree di `@legalio/ui-components` |
| :--- | :--- |
| **Tata Letak & Struktur (9)** | `aspect-ratio`, `bleed`, `container`, `scroll-area`, `separator`, `sidebar`, `simple-grid`, `splitter`, `stack` |
| **Navigasi (6)** | `breadcrumbs`, `navigation-menu`, `pagination`, `steps`, `tabs`, `toc` |
| **Formulir & Masukan (29)** | `angle-slider`, `button`, `checkbox`, `close-button`, `color-picker`, `combobox`, `date-input`, `date-picker`, `editable`, `field`, `fieldset`, `file-upload`, `input`, `input-group`, `listbox`, `native-select`, `number-input`, `password-input`, `pin-input`, `radio-group`, `rating-group`, `select`, `segment-group`, `signature-pad`, `slider`, `split-button`, `switch`, `tags-input`, `textarea`, `toggle`, `toggle-group` |
| **Overlay, Popover & Dialog (12)** | `command-palette`, `dialog`, `drawer`, `floating-panel`, `hover-card`, `lightbox`, `menu`, `popover`, `toast`, `tooltip`, `tour`, `empty` |
| **Tampilan Data & Konten (21)** | `accordion`, `alert`, `avatar`, `badge`, `card`, `carousel`, `chart`, `clipboard`, `collapsible`, `heading`, `highlight`, `image`, `image-cropper`, `json-tree-view`, `kbd`, `list`, `marquee`, `qr-code`, `table`, `tag`, `text`, `timer`, `tree-view`, `typeset` |
| **Indikator & Pemuatan (5)** | `progress-circular`, `progress-linear`, `skeleton`, `spinner`, `swap` |

---

## 3. Utilitas Tambahan (`@legalio/ui-components/utils`)
```tsx
import { cn, readableTextOn } from '@legalio/ui-components/utils';

// Merge className Tailwind
const className = cn('p-4', isHighlighted && 'bg-accent');

// Penjaga aksesibilitas kontras teks (WCAG AA >= 4.5:1) pada brand tenant
const textColor = readableTextOn(organization.brandColor);
```
