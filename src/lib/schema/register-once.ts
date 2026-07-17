/**
 * Register-once with a DEV-only survival valve for HMR/SSR registrar re-eval.
 *
 * The frozen contract (docs/design/plugin-contract.md § Schema registries) is
 * register-once, conflict-on-duplicate. Production and test keep it: a duplicate
 * throws. But a Vite dev server invalidates a registrar module and re-runs its
 * registerX calls while the registry Map instance survives — every route then
 * 500s on the dup throw until a full restart (docs/issues.md, SSR registrar
 * poison). In dev-and-not-test a duplicate REPLACES with a note instead, so a
 * re-run registrar overwrites its own prior registration: a changed registration
 * takes effect on re-run, an unchanged one is a harmless replace. The throw the
 * conflict-on-duplicate contract promises is unchanged everywhere it is observed
 * (production, and the tests that pin it — `isTest` keeps the throw).
 */
import { editorEnv } from '../env';
import { devWarn } from '../dev-warn';

/** True only on a dev server (not production, not a test run) — the one window the valve opens. */
export function devReplacesRegistration(): boolean {
	return editorEnv.isDev && !editorEnv.isTest;
}

/**
 * `apply` performs the registration and its side effects (cache invalidation,
 * pending-check enqueue) — it runs on a fresh register and on a dev replace, so a
 * re-run registrar with changed content re-primes those seams. A production or
 * test duplicate throws `conflict` and applies nothing.
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
