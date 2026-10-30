/**
 * Svelte's public API from the copy of Svelte this build of the editor runs, for a plugin
 * package's prebuilt build to import in place of `svelte`. A prebuild target, not an import for
 * hand-written code. The prebuilt exports only what plugins reach.
 */
import svelte from 'svelte/package.json' with { type: 'json' };

export * from 'svelte';

/** The Svelte version this runtime is; a plugin's prebuilt must be compiled by the same one. */
export const SVELTE_VERSION: string = svelte.version;
