/**
 * The editor's own copy of Svelte's public API, which each bundled plugin's prebuilt build imports
 * in place of `svelte`, so an app without Svelte runs one copy. Not for hand-written imports: the
 * prebuilt exports only the names the bundled plugins' components use, and that list changes with
 * them at any release.
 */
import svelte from 'svelte/package.json' with { type: 'json' };

export * from 'svelte';

/** The Svelte version this runtime is; a plugin's prebuilt must be compiled by the same one. */
export const SVELTE_VERSION: string = svelte.version;
