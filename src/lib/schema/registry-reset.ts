import { runEnrolledTestResets } from './register-once';

/**
 * Test-only. Drops every registration a plugin, a test or a plugin's setup made, and the state
 * that mirrors one (installed plugins, registration checks, warning memos); built-ins stay. Each
 * registry enrolls itself when it is created, so there is no list here to keep in step.
 */
export function __resetSchemaRegistriesForTests(): void {
	runEnrolledTestResets();
}
