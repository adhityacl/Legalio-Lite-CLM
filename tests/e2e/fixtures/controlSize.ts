import type { Page } from '@playwright/test';

/** moduix control size tokens (defaults: xs 24, sm 32, md 36, lg 40, xl 48). */
export type ControlSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Resolves `--moduix-size-<size>` to pixels in the page, so specs follow the design system rather than literals. */
export function controlSize(page: Page, size: ControlSize): Promise<number> {
  return page.evaluate((size) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;height:var(--moduix-size-${size})`;
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  }, size);
}
