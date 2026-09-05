/**
 * The editor's toolchain-coupling seam: build flags come from `esm-env`, here and at the
 * `if (DEV)` gates whose constant a production build folds away. The override door for a
 * toolchain those defaults read wrong (a bundler resolving no export conditions, a runner
 * other than Vitest) is published on the `@voithos-labs/aragonite/testing` subpath, not from here.
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

export function configureEditorEnv(partial: Partial<typeof editorEnv>): void {
	Object.assign(editorEnv, partial);
}

export function resetEditorEnv(): void {
	Object.assign(editorEnv, computeDefaults());
}
