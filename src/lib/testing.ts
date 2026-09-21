// The plugin-testing API, published at the `@voithos-labs/aragonite/testing` subpath. For test
// processes only, and nothing here may import a test runner: the kits run inside an author's
// own case, so failures come back as plain `Error`s. The registries register once with no way
// to unregister (docs/contributing/casebook.md), so every registration reachable from
// `@voithos-labs/aragonite/plugin` must wire its reset into the combined reset below.

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
 * schema registrations and all runtime state (undo stack, selection, DOM/CST) survive,
 * except that the paste reset clears every registered paste target, so a case exercising
 * built-in paste afterward must re-register. Throws outside a detected test environment.
 */
export function resetPluginPlatformForTests(): void {
	if (!editorEnv.isTest) {
		throw new Error(
			'resetPluginPlatformForTests() is test-only: it wipes the process-global plugin ' +
				'registries, which is corruption in a running editor. No test environment was ' +
				'detected (process.env.VITEST is unset). Detection is Vitest-specific; another ' +
				'runner opts in with configureEditorEnv({ isTest: true }), exported beside this.'
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

// ── Editor env override ──────────────────────────────────────────────────────
// What the reset's own error message points to: a runner other than Vitest declares itself
// a test environment here, and `resetEditorEnv` puts the detected defaults back.

export { configureEditorEnv, resetEditorEnv } from './env';

// ── Mounting the editor under a non-browser DOM ──────────────────────────────

export { installEditorDomStubsForTests } from './testing/mount-dom-stubs';

// ── Paste pipeline ───────────────────────────────────────────────────────────
// The production pipeline itself, not a test-only copy: the very function every
// clipboard-to-parse path runs (G4.11), so driving it observes the registered
// transforms rather than a re-implementation of them.

export { applyPasteTransforms } from './tree-operations/paste/paste-transforms';

// ── Where dev warnings go ────────────────────────────────────────────────────
// The channel every editor dev warning reaches, so a suite can build its own fail-on-warning
// check: register a callback, empty it per case, and fail on anything left unaccounted for.
// It works with any runner, and registering one silences the console line.

export { setDevWarnSink } from './dev-warn';
export type { DevWarnEntry, DevWarnSink } from './dev-warn';

// ── Container conformance kit (G4.3) ─────────────────────────────────────────

export {
	runContainerConformance,
	reversedAncestryLeavesRootStale
} from './testing/container-conformance';
export type { ConformanceCoverage } from './testing/conformance-core';
export type {
	ConformanceCell,
	ConformanceCellReport,
	ContainerConformanceProfile,
	ContainerConformanceReport,
	LocalIndexFixture
} from './testing/container-conformance';

// ── Generic per-kind conformance battery ─────────────────────────────────────
// Registering a kind signs it up for the closure cells that run without a browser;
// the browser pass runs the browser-only ones.

export { runKindConformance, checkCopyIsRawByteSlice } from './testing/kind-conformance';
export type {
	KindCellCheck,
	KindCellContext,
	KindCellReport,
	KindCellStatus,
	KindConformanceProfile,
	KindConformanceReport
} from './testing/kind-conformance';

// ── Inline-syntax conformance kit ────────────────────────────────────────────
// The behavioural tests a registered inline syntax handler is held to: what it takes,
// what it declines, and whether its widget behaves as a single unit.

export { runInlineKindConformance } from './testing/inline-conformance';
export type {
	InlineCellReport,
	InlineConformanceCell,
	InlineConformanceProfile,
	InlineConformanceReport
} from './testing/inline-conformance';
