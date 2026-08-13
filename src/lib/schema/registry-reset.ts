import { __removePluginBlockKindsForTests } from './block-kind-descriptor';
import { __removePluginComponentsForTests } from './block-component-registry';
import { __removePluginCompletersForTests } from './block-completions';
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
 * Test-only. Clears every non-built-in registration; built-ins survive. Also clears the warn
 * dedup, the registration-check latches, and the installed-plugin set — state that shadows a
 * registry must never outlive its reset.
 */
export function __resetSchemaRegistriesForTests(): void {
	__removePluginBlockKindsForTests();
	__removePluginComponentsForTests();
	__removePluginCompletersForTests();
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
