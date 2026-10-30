/**
 * Svelte's compiled-component runtime from the copy of Svelte this build of the editor runs, for a
 * plugin package's prebuilt build to import in place of `svelte/internal/client`. A prebuild
 * target, not an import for hand-written code. The prebuilt exports only what plugins reach.
 */
/* eslint-disable svelte/no-svelte-internal -- re-exporting the runtime is this module's job */
// @ts-expect-error Svelte publishes no types for the runtime its compiler writes calls into.
export * from 'svelte/internal/client';
