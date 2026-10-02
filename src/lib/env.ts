/**
 * Where the editor reads its build flags, and the one module that imports `esm-env`. The way to
 * override them for a toolchain these defaults read wrong (a bundler resolving no export
 * conditions, a runner other than Vitest) is published on the `@voithos-labs/aragonite/testing`
 * subpath, not here.
 */

import { DEV } from 'esm-env';

declare const process: { env?: Record<string, string | undefined> } | undefined;

function computeDefaults(): { isDev: boolean; isTest: boolean } {
	return {
		isDev: DEV,
		isTest: typeof process !== 'undefined' && !!process?.env?.VITEST
	};
}

export const editorEnv = computeDefaults();

/** Whether dev-only checks run: in a dev build, or wherever the override turned dev on. */
export function isDevChecks(): boolean {
	return DEV || editorEnv.isDev;
}

export function configureEditorEnv(partial: Partial<typeof editorEnv>): void {
	Object.assign(editorEnv, partial);
}

export function resetEditorEnv(): void {
	Object.assign(editorEnv, computeDefaults());
}
