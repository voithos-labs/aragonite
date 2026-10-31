/**
 * The editor's own copy of the runtime compiled Svelte components call, which each bundled plugin's
 * prebuilt build imports in place of `svelte/internal/client`. Not for hand-written imports: the
 * prebuilt exports only the names the bundled plugins' components use, and that list changes with
 * them at any release.
 */
/* eslint-disable svelte/no-svelte-internal -- re-exporting the runtime is this module's job */
// @ts-expect-error Svelte publishes no types for the runtime its compiler writes calls into.
export * from 'svelte/internal/client';
