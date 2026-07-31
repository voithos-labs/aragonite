// The plugin-testing surface, published at the `aragonite/testing` subpath. TEST
// PROCESSES ONLY, and nothing here may import a test runner — the kits run inside an
// author's own case, so failures surface as plain `Error`s.
//
// MAINTENANCE INVARIANT: the registries are register-once with no unregister
// (docs/contributing/culture.md), so every registration reachable from the public
// `aragonite/plugin` surface must wire its reset into the aggregate below.
// `testing-barrel.test.ts` fails when one is missing.

import { editorEnv } from './env';
import { __resetSchemaRegistriesForTests } from './schema/registry-reset';
import { __resetPasteSurfacesForTests } from './tree-operations/paste-surfaces';
import { __resetPasteTransformsForTests } from './tree-operations/paste/paste-transforms';
import { __resetInlineSyntaxForTests } from './core/inline/scan/plugin-syntax';
import { __resetInlineWidgetsForTests } from './core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from './schema/plugin-kind';
import { __resetDirectiveRegistryForTests } from './core/directive/registry';

/**
 * Reset the plugin platform's process-global registration state so a plugin's test suite
 * can re-install between cases: call it in `beforeEach`, then re-run your setup. Built-in
 * schema registrations and all runtime state (undo stack, selection, DOM/CST) survive —
 * except that the paste-surface reset clears ALL surfaces, so a case exercising built-in
 * paste afterward must re-register. Throws outside a detected test environment.
 */
export function resetPluginPlatformForTests(): void {
	if (!editorEnv.isTest) {
		throw new Error(
			'resetPluginPlatformForTests() is test-only — it wipes the process-global plugin ' +
				'registries, which is corruption in a running editor. No test environment was ' +
				'detected (process.env.VITEST is unset). Detection is Vitest-specific; another ' +
				'runner must opt in through the editor env seam before calling this.'
		);
	}
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	__resetPasteTransformsForTests();
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
	__resetDirectiveRegistryForTests();
}

// ── Container conformance kit (G4.3) ─────────────────────────────────────────

export {
	runContainerConformance,
	reversedAncestryLeavesRootStale
} from './testing/container-conformance';
export type {
	ConformanceCell,
	ConformanceCellReport,
	ConformanceCoverage,
	ContainerConformanceProfile,
	ContainerConformanceReport,
	LocalIndexFixture
} from './testing/container-conformance';

// ── Generic per-kind conformance battery ─────────────────────────────────────
// Registering a kind enrolls its headless closure cells; the browser sweep runs
// the browser-only cells.

export { runKindConformance, checkCopyIsRawByteSlice } from './testing/kind-conformance';
export type {
	KindCellCheck,
	KindCellContext,
	KindCellReport,
	KindCellStatus,
	KindConformanceProfile,
	KindConformanceReport
} from './testing/kind-conformance';

// ── Inline-rung conformance kit ──────────────────────────────────────────────
// The behavioral battery a registered inline rung is held to: what it claims, what
// it declines, and whether its widget is one atomic unit.

export { runInlineKindConformance } from './testing/inline-conformance';
export type {
	InlineCellReport,
	InlineConformanceCell,
	InlineConformanceProfile,
	InlineConformanceReport
} from './testing/inline-conformance';
