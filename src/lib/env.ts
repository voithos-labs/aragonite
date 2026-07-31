/**
 * The editor's single toolchain-coupling seam: the Vite/Vitest globals are read here and
 * nowhere else, so a consumer that lacks them overrides via `configureEditorEnv` instead
 * of inheriting a build assumption.
 */

declare const process: { env?: Record<string, string | undefined> } | undefined;

function computeDefaults(): { isDev: boolean; isTest: boolean } {
	return {
		isDev: import.meta.env.DEV,
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
