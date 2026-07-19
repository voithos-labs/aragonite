import { __removePluginBlockKindsForTests } from './block-kind-descriptor';
import { __removePluginComponentsForTests } from './block-component-registry';
import { __removePluginOpenersForTests } from './block-openers';
import {
	__removePluginCommandsForTests,
	__resetCommandWarningsForTests,
	__resetPluginGlobalKeymapForTests
} from './commands';
import { __resetBlockCommandsForTests } from './block-commands';
import { __resetPluginGlobalCommandsForTests } from './global-commands';
import { __clearDeclaredPluginKindsForTests } from './plugin-kind';
import { __resetRegistrationChecksForTests } from './registration-checks';
import { __resetInstalledPluginsForTests } from './plugin-install';

/**
 * Test-only. Clears every non-built-in registration; built-ins survive. Also
 * clears the dead-key warn dedup, the registration-check latches, and the
 * installed-plugin set — state that shadows a registry must never outlive its
 * reset: a warned id would swallow a re-mint's first-time warn, a surviving
 * first-flush or grammar-consumed latch would mislabel the next test's
 * registrations as post-bootstrap or late, and a surviving installed-set would
 * no-op re-installs into the wiped grammar.
 */
export function __resetSchemaRegistriesForTests(): void {
	__removePluginBlockKindsForTests();
	__removePluginComponentsForTests();
	__removePluginOpenersForTests();
	__removePluginCommandsForTests();
	__resetBlockCommandsForTests();
	__resetPluginGlobalCommandsForTests();
	__resetPluginGlobalKeymapForTests();
	__resetCommandWarningsForTests();
	__clearDeclaredPluginKindsForTests();
	__resetRegistrationChecksForTests();
	__resetInstalledPluginsForTests();
}
