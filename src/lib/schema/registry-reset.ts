/**
 * The one test reset of the plugin platform: every registry and every piece of state that
 * mirrors one enrolls its own reset here when its module loads, and the reset runs them all.
 * Imports nothing, so any schema module may enroll without an import cycle.
 */

const testResets: (() => void)[] = [];

/** Add process-global plugin state to the reset. A registry from `createPluginRegistry` enrolls
 *  itself; other state that mirrors a registry enrolls when its module loads. */
export function enrollTestReset(reset: () => void): void {
	testResets.push(reset);
}

/** Test-only. Drops every registration that is not a built-in, and the state that mirrors one
 *  (installed plugins, registration checks, warning memos). `resetPluginPlatformForTests` runs it. */
export function __resetSchemaRegistriesForTests(): void {
	for (const reset of testResets) reset();
}
