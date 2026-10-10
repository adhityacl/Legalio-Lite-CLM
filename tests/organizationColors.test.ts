import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accentPalettes, contrastRatio, findAccentPalette, organizationThemeTokens } from '../apps/frontend/src/lib/organizationColors';

test('all Radix families persist unambiguously and supply readable solid action labels in both themes', () => {
  assert.equal(accentPalettes.length, 31);
  for (const palette of accentPalettes) {
    assert.equal(palette.light.length, 12);
    assert.equal(palette.dark.length, 12);
    const stored = palette.light[8].toUpperCase();
    assert.equal(findAccentPalette(stored)?.name, palette.name);
    for (const dark of [false, true]) {
      const tokens = organizationThemeTokens(stored, dark);
      assert.equal(tokens['--brand-primary'], stored);
      assert.equal(tokens['--line-brand-green'], palette[dark ? 'dark' : 'light'][8]);
      const bright = ['amber', 'yellow', 'lime', 'mint', 'sky'].includes(palette.name);
      assert.equal(tokens['--primary-foreground'], bright ? '#111111' : '#ffffff');
      for (const [solid, foreground] of [[tokens['--primary'], tokens['--primary-foreground']], [tokens['--primary-hover'], tokens['--primary-hover-foreground']], [tokens['--accent'], tokens['--accent-foreground']], [tokens['--primary-disabled'], tokens['--primary-disabled-foreground']]]) {
        assert.ok(contrastRatio(solid, foreground) >= 4.5, `${palette.name} ${dark ? 'dark' : 'light'} ${solid}`);
      }
    }
  }
});

test('Iris and Grass have white solid labels without changing their saved palette', () => {
  for (const color of ['#5B5BD6', '#46A758']) {
    for (const dark of [false, true]) {
      const tokens = organizationThemeTokens(color, dark);
      assert.equal(tokens['--brand-primary'], color);
      assert.equal(tokens['--primary-foreground'], '#ffffff');
      assert.equal(tokens['--primary-hover-foreground'], '#ffffff');
      assert.ok(contrastRatio(tokens['--primary'], '#ffffff') >= 4.5);
      assert.ok(contrastRatio(tokens['--primary-hover'], '#ffffff') >= 4.5);
    }
  }
});

test('existing custom organization colors keep their saved value', () => {
  assert.equal(findAccentPalette('#0537FF'), undefined);
  assert.equal(organizationThemeTokens('#0537FF', false)['--primary'], '#0537FF');
  assert.equal(organizationThemeTokens('#0537FF', true)['--primary'], '#0537FF');
  assert.equal(organizationThemeTokens('invalid', false)['--primary'], '#2653F6');
});
