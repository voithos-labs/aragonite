/**
 * Register-once, with one exception on a dev server so hot reload and SSR may re-run a plugin's
 * registration. The frozen contract (docs/design/plugin-contract.md § The registries: global,
 * register-once) is that a duplicate is an error, and production and test keep the throw. On a dev
 * server that throw would break every route until restart, so there a duplicate replaces the entry
 * and warns instead. Depends on nothing in `schema/`, so any registry module may import it.
 */
import { editorEnv } from '../env';
import { devWarn } from '../dev-warn';

/** True only on a dev server, not in production and not in a test run: the one case that replaces. */
export function devReplacesRegistration(): boolean {
	return editorEnv.isDev && !editorEnv.isTest;
}

/**
 * `apply` does the registration and its side effects. It runs both on a first registration and on
 * a dev-server replacement, so re-running a plugin with changed content updates everything again.
 */
export function registerOnce(isDuplicate: boolean, apply: () => void, conflict: string): void {
	if (isDuplicate) {
		if (devReplacesRegistration()) {
			devWarn('registry', `${conflict}: dev re-registration replaces (HMR/SSR survival)`);
			apply();
			return;
		}
		throw new Error(conflict);
	}
	apply();
}

// ── Test reset ───────────────────────────────────────────────────────────────

const testResets: (() => void)[] = [];

/** Add process-global plugin state to the one test reset. A registry from `createPluginRegistry`
 *  enrolls itself; other state that mirrors a registry enrolls here when its module loads. */
export function enrollTestReset(reset: () => void): void {
	testResets.push(reset);
}

/** Run every enrolled reset: `__resetSchemaRegistriesForTests` and the published reset both call it. */
export function runEnrolledTestResets(): void {
	for (const reset of testResets) reset();
}
