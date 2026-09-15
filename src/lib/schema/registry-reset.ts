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
import { __clearDeclaredPluginKindsForTests } from './plugin-kind';
import { __resetRegistrationChecksForTests } from './registration-checks';
import { __resetInstalledPluginsForTests } from './plugin-install';
import { __resetInlineConstructPoliciesForTests } from './inline-construct-policy';

/**
 * Test-only. Clears every non-built-in registration; built-ins stay. Also clears the warning
 * de-duplication, the registration-check flags and the installed-plugin set, since state that
 * mirrors a registry must never outlive its reset. The two single-function registrations (the live
 * split rebalancer, the join cleaner) have their own resets: only a suite testing one clears it.
 */
export function __resetSchemaRegistriesForTests(): void {
	__removePluginBlockKindsForTests();
	__removePluginComponentsForTests();
	__removePluginCompletersForTests();
	__removePluginOpenersForTests();
	__removePluginCommandsForTests();
	__resetBlockCommandsForTests();
	__resetInlineConstructPoliciesForTests();
	__resetPluginGlobalKeymapForTests();
	__resetCommandWarningsForTests();
	__clearDeclaredPluginKindsForTests();
	__resetRegistrationChecksForTests();
	__resetInstalledPluginsForTests();
}
