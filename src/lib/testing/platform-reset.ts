// The test-only reset of the plugin platform's process-global registries.

import { isTestProcess } from '@voithos-labs/aragonite/dev-checks';
import { __resetSchemaRegistriesForTests } from '../schema/registry-reset';

/** Empties every registry a plugin writes into, so a suite can re-install per case; the editor's
 *  built-ins and its runtime state survive. Throws outside a detected test environment. */
export function resetPluginPlatformForTests(): void {
	if (!isTestProcess) {
		throw new Error(
			'resetPluginPlatformForTests() is test-only: it wipes the process-global plugin ' +
				'registries, which is corruption in a running editor. No test environment was ' +
				'detected (process.env.VITEST is unset). Detection is Vitest-specific; another ' +
				'runner opts in with configureEditorEnv({ isTest: true }), exported beside this.'
		);
	}
	__resetSchemaRegistriesForTests();
}
