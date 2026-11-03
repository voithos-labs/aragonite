// The plugin-testing API, published at the `@voithos-labs/aragonite/testing` subpath. For test
// processes only, and nothing here may import a test runner: the kits run inside an author's
// own case, so failures come back as plain `Error`s.

import { activationFor, everyInstalledPlugin } from './schema/plugin-activation';
import { applyPasteTransforms as runPasteTransforms } from './tree-operations/paste/paste-transforms';

export { resetPluginPlatformForTests } from './testing/platform-reset';

// ── Editor env override ──────────────────────────────────────────────────────
// What the reset's own error message points to: a runner other than Vitest declares itself
// a test environment here, and `resetEditorEnv` puts the detected defaults back.

export { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';

// ── Mounting the editor under a non-browser DOM ──────────────────────────────

export { installEditorDomStubsForTests } from './testing/mount-dom-stubs';

export { readingTabOrderProblem } from './testing/reading-tab-order';

// ── Paste pipeline ───────────────────────────────────────────────────────────

/**
 * The production paste pipeline, the very function every clipboard-to-parse path runs (G4.11),
 * over `text` as an editor whose `plugins` prop lists `plugins` would run it; absent, every
 * installed plugin's transforms run.
 */
export function applyPasteTransforms(text: string, plugins?: readonly string[]): string {
	return runPasteTransforms(text, plugins ? activationFor(plugins) : everyInstalledPlugin);
}

// ── Where dev warnings go ────────────────────────────────────────────────────
// The channel every editor dev warning reaches, for a suite's own fail-on-warning check: register
// a callback, empty it per case, fail on leftovers. Registering one silences the console line.

export { setDevWarnSink } from '@voithos-labs/aragonite/dev-checks';
export type { DevWarnEntry, DevWarnSink } from '@voithos-labs/aragonite/dev-checks';

// ── Conformance kits: the shared vocabulary ──────────────────────────────────
// Every kit reports a cell as a `CellReport`; the container and inline profiles declare each
// cell's coverage as a `ConformanceCoverage`.

export type { CellReport, CellStatus, ConformanceCoverage } from './testing/conformance-core';

// ── Container conformance kit ────────────────────────────────────────────────

export {
	runContainerConformance,
	reversedAncestryLeavesRootStale
} from './testing/container-conformance';
export type {
	ConformanceCell,
	ContainerConformanceProfile,
	ContainerConformanceReport,
	LocalIndexFixture
} from './testing/container-conformance';

// ── Generic per-kind conformance battery ─────────────────────────────────────
// Registering a kind signs it up for the closure cells that run without a browser;
// the browser pass runs the browser-only ones.

export { runKindConformance, checkCopyIsRawByteSlice } from './testing/kind-conformance';
export type {
	KindCell,
	KindCellCheck,
	KindCellContext,
	KindConformanceProfile,
	KindConformanceReport
} from './testing/kind-conformance';

// ── Inline-syntax conformance kit ────────────────────────────────────────────
// The behavioural tests a registered inline syntax handler is held to: what it takes,
// what it declines, and whether its widget behaves as a single unit.

export { runInlineKindConformance } from './testing/inline-conformance';
export type {
	InlineConformanceCell,
	InlineConformanceProfile,
	InlineConformanceReport
} from './testing/inline-conformance';

// ── Inline-menu commit conformance cell ──────────────────────────────────────
// What a source's `onCommit` is held to: a commit that waits writes nothing into a note the host
// loaded meanwhile.

export { checkInlineMenuCommitAcrossSwap } from './testing/inline-menu-conformance';
export type { InlineMenuCommitCase } from './testing/inline-menu-conformance';

// ── Whole-plugin conformance ─────────────────────────────────────────────────
// Every kit over every kind a plugin's setup declares: what a plugin package's `./conformance`
// export feeds, and what `aragonite-plugin-check` runs.

export { runPluginConformance } from './testing/plugin-conformance';
export type { PluginConformanceReport, PluginConformanceSuite } from './testing/plugin-conformance';
