/**
 * The editor's toolchain-coupling seam: build flags come from `esm-env`, here and at the
 * `if (DEV)` gates whose constant a production build folds away. A consumer whose bundler
 * resolves no export conditions overrides via `configureEditorEnv` rather than inheriting
 * a build assumption.
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
