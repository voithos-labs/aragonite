// The plugin-testing surface, published at the `aragonite/testing` subpath.
// TEST PROCESSES ONLY — never import from production code. Two seams:
//
//   1. `resetPluginPlatformForTests` — wipes the process-global plugin registries
//      so a plugin's test suite can re-install a fresh copy per case; run in a
//      real app it is corruption, so it throws unless a test environment is
//      detected (see the guard below).
//   2. The conformance kits — the harnesses an author points at their own
//      registration: the per-kind closure battery, the G4.3 container kit, and the
//      inline-rung kit, each re-exported from its own module under `testing/`.
//
// Why (1) exists: the platform is register-once / throw-on-duplicate / no
// unregister ("Registries are code, not state" — docs/contributing/culture.md). In-repo suites
// reach past `$lib` for a scatter of internal reset helpers; a third-party author
// writing a normal Vitest suite has no sanctioned seam and hits the dup throw on
// the second `beforeEach`. This barrel is that seam — the ONLY place the resets
// are public, and deliberately off the `aragonite/plugin` authoring barrel.
//
// Nothing here may import a test runner: the kit runs INSIDE an author's own test
// case and must not force a runner (or an unlisted dep) on a suite that reaches
// for the reset alone. Failures surface as plain `Error`s, which every runner
// reports.
//
// MAINTENANCE INVARIANT: every register-once registration reachable from the
// public `aragonite/plugin` surface must have its reset wired into the aggregate
// below. Adding a new public registration without wiring its reset here re-opens
// the exact dup-throw this seam closes — `testing-barrel.test.ts` registers
// through each public entry and asserts the aggregate clears it, so a missing
// wire fails there rather than in a downstream author's suite.

import { editorEnv } from './env';
import { __resetSchemaRegistriesForTests } from './schema/registry-reset';
import { __resetPasteSurfacesForTests } from './tree-operations/paste-surfaces';
import { __resetPasteTransformsForTests } from './tree-operations/paste/paste-transforms';
import { __resetInlineSyntaxForTests } from './core/inline/scan/plugin-syntax';
import { __resetInlineWidgetsForTests } from './core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from './schema/plugin-kind';
import { __resetDirectiveRegistryForTests } from './core/directive/registry';

/**
 * Reset the plugin platform's process-global registration state so a plugin's
 * test suite can re-install between cases. Call it in `beforeEach`, then re-run
 * your plugin's setup.
 *
 * Clears every non-built-in schema registration (block kinds, components,
 * openers, commands, block-commands, declared block + inline kinds, installed
 * plugins), the inline syntax + widget registries, the paste-surface and
 * paste-transform pipelines, and the `:::name` directive registry.
 *
 * Does NOT reset: built-in schema registrations (they survive, as in production);
 * the code-block language/highlight registries (editor internals, not a plugin
 * surface); or any runtime state (undo stack, selection, editor DOM/CST). One
 * asymmetry to know: the paste-surface reset clears ALL surfaces including the
 * built-ins, so a case that exercises built-in-block paste after a reset must
 * re-register or skip the reset — parse/round-trip cases are unaffected.
 *
 * Throws outside a detected test environment: wiping live registries is a
 * production corruption, never a supported runtime operation.
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
