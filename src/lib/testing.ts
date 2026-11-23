// The plugin-testing API, published at the `@voithos-labs/aragonite/testing` subpath. For test
// processes only, and nothing here may import a test runner: the kits run inside an author's
// own case, so failures come back as plain `Error`s.

import { createEditorActivation } from './schema/plugin-activation';
import {
	installPlugins,
	normalizePluginEntries,
	runningNames,
	type PluginsProp
} from './schema/plugin-install';
import { pluginCheckContext } from './testing/check-context';
import { heardOutside, pasted } from './testing/rewrite-check';

// ── Checking a plugin value ──────────────────────────────────────────────────
// Every check over every sample of everything a plugin lists: what a package's `./conformance`
// export feeds, and what `aragonite-plugin-check` runs.

export { check, CheckFailure, isCheckFailure } from './testing/check';
export type {
	CheckName,
	CheckOptions,
	CheckReport,
	CheckRow,
	CheckStatus,
	Conformance,
	Excuses
} from './testing/check';

// ── Editor env override ──────────────────────────────────────────────────────
// What `check` and the reset point to: a runner other than Vitest turns the dev checks on, or
// declares itself a test process, here; `resetEditorEnv` puts the detected defaults back.

export { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';

// ── Helpers ──────────────────────────────────────────────────────────────────

export { headless } from './testing/mount-dom-stubs';
export { tabOrder } from './testing/reading-tab-order';

/**
 * `text` as an editor listing `plugins` rewrites a paste from the clipboard that reads as blocks:
 * the whole-paste rewrites, then those by type; undefined lists every installed `setup` plugin. It
 * answers for that paste alone: plain text and the editor's own copy are never rewritten. A listed
 * `setup` plugin is installed in the process, as an editor's `plugins` prop installs it.
 */
export function rewritePaste(text: string, plugins: PluginsProp | undefined): string {
	const entries = plugins?.length ? normalizePluginEntries(plugins) : undefined;
	if (entries) installPlugins(entries.plugins);
	const run = pluginCheckContext(entries?.values ?? [], heardOutside);
	try {
		run.stage(text);
		const names = entries ? runningNames(entries, run.units) : null;
		const activation = createEditorActivation(names, run.contributions);
		return pasted(run.readingWith(activation), activation, text);
	} finally {
		run.release();
	}
}

// ── Kits for setup plugins ───────────────────────────────────────────────────
// The kits for `setup` plugins and the reset of their process-wide registries. Nothing joins
// this section: a plugin value goes through `check`.

export { resetPluginPlatformForTests } from './testing/platform-reset';
export {
	runContainerConformance,
	runInlineKindConformance,
	runKindConformance,
	runPluginConformance
} from './testing/plugin-conformance';
export type { PluginConformanceReport, PluginConformanceSuite } from './testing/plugin-conformance';
export type { CellReport, CellStatus, ConformanceCoverage } from './testing/conformance-core';
export type {
	ConformanceCell,
	ContainerConformanceProfile,
	ContainerConformanceReport,
	LocalIndexFixture
} from './testing/container-conformance';
export type {
	KindCell,
	KindCellCheck,
	KindCellContext,
	KindConformanceProfile,
	KindConformanceReport
} from './testing/kind-conformance';
export type {
	InlineConformanceCell,
	InlineConformanceProfile,
	InlineConformanceReport
} from './testing/inline-conformance';
