# `@legalio/ui-components`

Paket Design System resmi internal untuk platform Legalio CLM.

## Prinsip
1. **Zero External Dependency Risk:** Komponen dimiliki (*copy-owned / in-tree*) di dalam paket ini. Aplikasi konsumen (`apps/frontend`, `apps/backend/console`) hanya mengimpor dari paket internal ini.
2. **Accessible by Default:** Menggunakan headless primitives teruji (`@ark-ui/react`, `@radix-ui`), WAI-ARIA compliant, dan keyboard accessible.
3. **Semantic Theming:** Sepenuhnya terikat pada token desain [`src/styles/theme.css`](src/styles/theme.css) dan mendukung multi-tenant branding.

## Penggunaan di Aplikasi
```tsx
import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Dialog, ModalFrame } from '@legalio/ui-components/dialog';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { cn, readableTextOn } from '@legalio/ui-components/utils';
```

## Panduan Lengkap
Lihat dokumentasi design system di [`docs/design-system/README.md`](../../docs/design-system/README.md).

