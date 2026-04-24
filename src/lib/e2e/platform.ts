/**
 * Platform-modifier helpers for E2E specs. Centralizes the
 * `Control` (default) vs `Meta` (macOS) selection in one place so individual
 * tests don't each redeclare the Node `process` global (`@types/node` isn't
 * installed on this project, so a narrow local declaration stands in).
 */

declare const process: { platform: string };

export const isMac = process.platform === 'darwin';
export const primaryModifier: 'Meta' | 'Control' = isMac ? 'Meta' : 'Control';
