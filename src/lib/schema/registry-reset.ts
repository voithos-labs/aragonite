import { __removePluginBlockKindsForTests } from './block-kind-descriptor';
import { __removePluginComponentsForTests } from './block-component-registry';
import { __removePluginOpenersForTests } from './block-openers';
import { __removePluginCommandsForTests, __resetCommandWarningsForTests } from './commands';
import { __resetBlockCommandsForTests } from './block-commands';
import { __clearDeclaredPluginKindsForTests } from './plugin-kind';
import { __resetRegistrationChecksForTests } from './registration-checks';

/**
 * Test-only. Clears every non-built-in registration; built-ins survive. Also
 * clears the dead-key warn dedup and the registration-check latches — state
 * that shadows a registry must never outlive its reset: a warned id would
 * swallow a re-mint's first-time warn, and a surviving first-flush or
 * grammar-consumed latch would mislabel the next test's registrations as
 * post-bootstrap or late.
 */
export function __resetSchemaRegistriesForTests(): void {
	__removePluginBlockKindsForTests();
	__removePluginComponentsForTests();
	__removePluginOpenersForTests();
	__removePluginCommandsForTests();
	__resetBlockCommandsForTests();
	__resetCommandWarningsForTests();
	__clearDeclaredPluginKindsForTests();
	__resetRegistrationChecksForTests();
}
