/**
 * Centralizes the `Control` vs `Meta` selection so specs need not each redeclare the Node
 * `process` global — `@types/node` is not installed here, so a narrow local declaration
 * stands in.
 */

declare const process: { platform: string };

export const isMac = process.platform === 'darwin';
export const primaryModifier: 'Meta' | 'Control' = isMac ? 'Meta' : 'Control';
