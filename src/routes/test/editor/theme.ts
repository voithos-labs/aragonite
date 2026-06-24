import { writable } from 'svelte/store';

// Route-local stand-in for limestone's app-level $lib/theme. The editor owns its
// own tokens (editor-theme.css, scoped to .editor / .limestone-editor-theme) and
// app.css supplies the :root chrome fallbacks, so applyTheme is a no-op here — the
// demo only needs a theme name to feed the <Editor theme> prop.
export type ThemeType = 'light' | 'dark';

export const DEFAULT_THEME: ThemeType = 'dark';
export const currentThemeType = writable<ThemeType>(DEFAULT_THEME);
export function applyTheme(_theme?: unknown): void {}
