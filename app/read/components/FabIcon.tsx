import type { ReactNode } from 'react';

function StrokeIcon({ path }: { path: string }) {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
    </svg>
  );
}

const FAB_ICONS = {
  bookmark: <StrokeIcon path="M11 19l-7-7 7-7m8 14l-7-7 7-7" />,
  copyPage: (
    <StrokeIcon path="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  ),
  copyRange: <StrokeIcon path="M4 7h16M4 12h16M4 17h10" />,
  prioritize: (
    <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  ),
  busy: (
    <span
      className="w-[16px] h-[16px] animate-spin"
      style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'currentColor', borderTopColor: 'transparent', borderRadius: '50%' }}
    />
  ),
  rephrase: <span className="text-xs font-semibold">R</span>,
  furigana: (
    <span className="text-xs font-semibold" style={{ fontFamily: 'serif' }}>
      {'あ'}
    </span>
  ),
  rubyLookup: <StrokeIcon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
  lightMode: (
    <StrokeIcon path="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  ),
  darkMode: <StrokeIcon path="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />,
  settings: (
    <StrokeIcon path="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
  ),
} satisfies Record<string, ReactNode>;

export type FabIconName = keyof typeof FAB_ICONS;

export default function FabIcon({ name }: { name: FabIconName }) {
  return FAB_ICONS[name];
}
