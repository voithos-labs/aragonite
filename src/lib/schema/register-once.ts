/**
 * Register-once with a DEV-only survival valve for HMR/SSR registrar re-eval. The frozen
 * contract (docs/design/plugin-contract.md § Schema registries) is conflict-on-duplicate, and
 * production and test keep the throw. On a dev server a re-run registrar would otherwise 500
 * every route until restart, so there a duplicate replaces with a note instead.
 */
import { editorEnv } from '../env';
import { devWarn } from '../dev-warn';

/** True only on a dev server (not production, not a test run) — the one window the valve opens. */
export function devReplacesRegistration(): boolean {
	return editorEnv.isDev && !editorEnv.isTest;
}

/**
 * `apply` carries the registration and its side effects, and runs on a fresh register AND on a
 * dev replace, so a re-run registrar with changed content re-primes those seams.
 */
export function registerOnce(isDuplicate: boolean, apply: () => void, conflict: string): void {
	if (isDuplicate) {
		if (devReplacesRegistration()) {
			devWarn('registry', `${conflict} — dev re-registration replaces (HMR/SSR survival)`);
			apply();
			return;
		}
		throw new Error(conflict);
	}
	apply();
}
