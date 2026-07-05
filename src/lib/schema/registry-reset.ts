import { __removePluginBlockKindsForTests } from './block-kind-descriptor';
import { __removePluginComponentsForTests } from './block-component-registry';
import { __removePluginOpenersForTests } from './block-openers';
import { __removePluginCommandsForTests } from './commands';
import { __resetBlockCommandsForTests } from './block-commands';
import { __clearDeclaredPluginKindsForTests } from './plugin-kind';

/** Test-only. Clears every non-built-in registration; built-ins survive. */
export function __resetSchemaRegistriesForTests(): void {
	__removePluginBlockKindsForTests();
	__removePluginComponentsForTests();
	__removePluginOpenersForTests();
	__removePluginCommandsForTests();
	__resetBlockCommandsForTests();
	__clearDeclaredPluginKindsForTests();
}
