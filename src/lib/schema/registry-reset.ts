import { __removePluginBlockKindsForTests } from './block-kind-descriptor';
import { __removePluginComponentsForTests } from './block-component-registry';
import { __removePluginOpenersForTests } from './block-openers';
import { __removePluginCommandsForTests, __resetCommandWarningsForTests } from './commands';
import { __resetBlockCommandsForTests } from './block-commands';
import { __clearDeclaredPluginKindsForTests } from './plugin-kind';

/**
 * Test-only. Clears every non-built-in registration; built-ins survive. Also
 * clears the dead-key warn dedup, so it can't desync from the minted-id set it
 * shadows — a warned id that outlived a schema reset would swallow a re-mint's
 * first-time warn.
 */
export function __resetSchemaRegistriesForTests(): void {
	__removePluginBlockKindsForTests();
	__removePluginComponentsForTests();
	__removePluginOpenersForTests();
	__removePluginCommandsForTests();
	__resetBlockCommandsForTests();
	__resetCommandWarningsForTests();
	__clearDeclaredPluginKindsForTests();
}
