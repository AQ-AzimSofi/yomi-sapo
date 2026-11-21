import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLORS, DARK_COLORS, READER_THEME, THEME } from '@/lib/constants';
import type { ReaderTheme } from './read/readerTheme';

const GLOBALS_CSS = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

function tokensOf(selector: string): Record<string, string> {
  const blockStart = GLOBALS_CSS.indexOf(`${selector} {`);
  if (blockStart < 0) throw new Error(`globals.css has no "${selector}" block`);
  const block = GLOBALS_CSS.slice(blockStart, GLOBALS_CSS.indexOf('}', blockStart));
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
  );
}

const DARK_THEME: ReaderTheme = 'dark';

const LIGHT_TOKENS = tokensOf(':root');
// The :root prefix outranks the plain :root block, so the dark values win wherever the file puts them.
const DARK_TOKENS = tokensOf(`:root[data-theme='${DARK_THEME}']`);

describe('reader theme tokens in globals.css', () => {
  it('give the light theme the COLORS and READER_THEME palette', () => {
    expect(LIGHT_TOKENS).toMatchObject({
      '--color-base': COLORS.BASE,
      '--color-surface': COLORS.SURFACE,
      '--color-surface-muted': READER_THEME.SURFACE_MUTED,
      '--color-reader-bg': READER_THEME.SURFACE,
      '--color-field': COLORS.SURFACE,
      '--color-ink': COLORS.INK,
      '--color-on-ink': COLORS.SURFACE,
      '--color-neutral': COLORS.NEUTRAL,
      '--color-neutral-soft': COLORS.NEUTRAL_SOFT,
      '--color-primary': COLORS.PRIMARY,
      '--color-on-primary': COLORS.SURFACE,
      '--color-secondary': COLORS.SECONDARY,
      '--color-secondary-dark': COLORS.SECONDARY_DARK,
      '--color-progress-track': READER_THEME.PROGRESS_TRACK,
      '--color-toggle-thumb': COLORS.SURFACE,
    });
  });

  it('give the dark theme the DARK_COLORS palette', () => {
    expect(DARK_TOKENS).toMatchObject({
      '--color-base': DARK_COLORS.BASE,
      '--color-surface': DARK_COLORS.SURFACE,
      '--color-surface-muted': DARK_COLORS.SURFACE,
      '--color-reader-bg': DARK_COLORS.BASE,
      '--color-field': DARK_COLORS.BASE,
      '--color-ink': DARK_COLORS.TEXT,
      '--color-on-ink': DARK_COLORS.BASE,
      '--color-neutral': DARK_COLORS.NEUTRAL,
      '--color-neutral-soft': DARK_COLORS.SURFACE,
      '--color-primary': DARK_COLORS.PRIMARY,
      '--color-on-primary': DARK_COLORS.BASE,
      '--color-secondary': DARK_COLORS.TEXT_MUTED,
      '--color-secondary-dark': DARK_COLORS.TEXT_MUTED,
      '--color-progress-track': DARK_COLORS.NEUTRAL,
      '--color-toggle-thumb': DARK_COLORS.TEXT,
    });
  });

  it('define every variable THEME refers to in both themes', () => {
    const themeVariables = Object.values(THEME).map((reference) => reference.replace(/^var\((--[\w-]+)\)$/, '$1'));

    const missingInLight = themeVariables.filter((name) => !(name in LIGHT_TOKENS));
    const missingInDark = themeVariables.filter((name) => !(name in DARK_TOKENS));

    expect({ missingInLight, missingInDark }).toEqual({ missingInLight: [], missingInDark: [] });
  });
});
