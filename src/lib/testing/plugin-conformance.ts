/**
 * The whole-plugin conformance run: install a plugin's units on a blank platform, then hold every
 * block and inline kind their setups declared to the kits. It is what a plugin listing checks, so
 * a kind can't pass by being left out: a container or inline kind needs its profile.
 */

import { devChecksOn, setDevWarnSink, type DevWarnEntry } from '@voithos-labs/aragonite/dev-checks';
import type { AnyBlockKind } from '../core/nodes';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import {
	installPlugins,
	normalizePluginEntries,
	type EditorPlugin
} from '../schema/plugin-install';
import { installPluginList, type PluginList } from '../schema/plugin-unit';
import {
	declaredPluginInlineKind,
	pluginInlineKindsDeclaredBy,
	pluginKindsDeclaredBy
} from '../schema/plugin-kind';
import { defaultCheckContext } from './check-context';
import {
	reversedAncestryLeavesRootStale as reversedAncestryStale,
	runContainerCells,
	type ContainerConformanceProfile,
	type ContainerConformanceReport
} from './container-conformance';
import {
	runInlineCells,
	type InlineConformanceProfile,
	type InlineConformanceReport
} from './inline-conformance';
import {
	checkCopyIsRawByteSlice as checkCopySlice,
	runKindCells,
	type KindConformanceProfile,
	type KindConformanceReport
} from './kind-conformance';
import { resetPluginPlatformForTests } from './platform-reset';

/** A plugin package's conformance suite: its units, plus a profile per container and inline
 *  kind they declare, each keyed by the kind's name since the kinds exist only after install. */
export interface PluginConformanceSuite {
	plugins: readonly (EditorPlugin | PluginList[number])[];
	containers?: Readonly<Record<string, ContainerConformanceProfile>>;
	inline?: readonly (Omit<InlineConformanceProfile, 'kind'> & { kind?: string })[];
}

export interface PluginConformanceReport {
	plugins: string[];
	kinds: KindConformanceReport[];
	containers: ContainerConformanceReport[];
	inline: InlineConformanceReport[];
}

/** Every kit over every kind the suite's plugins declare. Throws one `Error` naming each failed
 *  cell, each kind without the profile its tier needs, and each dev warning the run raised. */
export async function runPluginConformance(
	suite: PluginConformanceSuite
): Promise<PluginConformanceReport> {
	const names = suite.plugins.map((plugin) => plugin.name);
	const heading = `plugin conformance failed for ${names.map((name) => `"${name}"`).join(', ')}`;
	if (!devChecksOn) {
		throw new Error(
			`${heading}:\n  - dev checks are off, so a contract warning would pass unseen; call ` +
				'configureEditorEnv({ isDev: true }) from @voithos-labs/aragonite/testing first'
		);
	}
	const failures: string[] = [];
	const warnings: DevWarnEntry[] = [];
	const previousSink = setDevWarnSink((entry) => warnings.push(entry));
	const report: PluginConformanceReport = { plugins: names, kinds: [], containers: [], inline: [] };
	try {
		resetPluginPlatformForTests();
		const { plugins, values } = normalizePluginEntries(suite.plugins);
		installPlugins(plugins);
		// A plugin value installs per editor: reading its list is where it's refused.
		installPluginList(values, ({ cause }) => failures.push(String((cause as Error)?.message)));
		const blockKinds: AnyBlockKind[] = names.flatMap(pluginKindsDeclaredBy);
		const inlineKinds = names.flatMap(pluginInlineKindsDeclaredBy);
		for (const problem of missingProfiles(suite, blockKinds, inlineKinds)) failures.push(problem);

		for (const kind of blockKinds) {
			const ran = await collect(() => runKindConformance(kind), failures);
			if (ran) report.kinds.push(ran);
			const profile = suite.containers?.[kind];
			if (!profile || !getBlockKindDescriptor(kind).isContainer) continue;
			const container = await collect(() => runContainerConformance(kind, profile), failures);
			if (container) report.containers.push(container);
		}
		for (const { kind, ...profile } of suite.inline ?? []) {
			const inlineProfile: InlineConformanceProfile =
				kind === undefined ? profile : { ...profile, kind: declaredPluginInlineKind(kind) };
			const inline = await collect(() => runInlineKindConformance(inlineProfile), failures);
			if (inline) report.inline.push(inline);
		}
	} catch (error) {
		failures.push((error as Error).message);
	} finally {
		setDevWarnSink(previousSink);
	}
	for (const { tag, message } of warnings) failures.push(`dev warning [${tag}]: ${message}`);
	if (failures.length > 0) throw new Error(`${heading}:\n  - ${failures.join('\n  - ')}`);
	return report;
}

// ── The kits one at a time ───────────────────────────────────────────────────
// Each runs over the kinds registered process-wide, read with every installed plugin's syntax.

/** Runs every headless kind cell for `kind`, or throws an `Error` naming each failed cell. */
export function runKindConformance(
	kind: AnyBlockKind,
	profile?: KindConformanceProfile
): Promise<KindConformanceReport> {
	return runKindCells(defaultCheckContext, kind, profile);
}

/** Runs every container cell for `kind` over `profile`, or throws naming each failed cell. */
export function runContainerConformance(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): Promise<ContainerConformanceReport> {
	return runContainerCells(defaultCheckContext, kind, profile);
}

/** Runs every inline cell for the registered handler `profile` names, or throws naming each
 *  failed cell. */
export function runInlineKindConformance(
	profile: InlineConformanceProfile
): Promise<InlineConformanceReport> {
	return runInlineCells(defaultCheckContext, profile);
}

/** Asserts the default cross-block copy over `kind`'s fixture is a raw byte slice at both ends. */
export function checkCopyIsRawByteSlice(kind: AnyBlockKind, fixture: string): void {
	checkCopySlice(defaultCheckContext, kind, fixture);
}

/** Shows the ancestry check can fail: true when an outer-first rebuild leaves the root stale. */
export function reversedAncestryLeavesRootStale(profile: ContainerConformanceProfile): boolean {
	return reversedAncestryStale(defaultCheckContext, profile);
}

// ── Internals ────────────────────────────────────────────────────────────────

/** Every container or inline kind left without a profile, and every profile naming no kind the
 *  plugins declared, so an unprofiled kind can't slip past and a stale profile can't pass. */
function missingProfiles(
	suite: PluginConformanceSuite,
	blockKinds: readonly AnyBlockKind[],
	inlineKinds: readonly string[]
): string[] {
	const problems: string[] = [];
	const containers = blockKinds.filter((kind) => getBlockKindDescriptor(kind).isContainer);
	for (const kind of containers) {
		if (!suite.containers?.[kind]) {
			problems.push(`container kind "${kind}" has no profile in the suite's containers`);
		}
	}
	for (const name of Object.keys(suite.containers ?? {})) {
		if (!containers.includes(name as AnyBlockKind)) {
			problems.push(`containers names "${name}", which these plugins declare no container as`);
		}
	}
	const profiled = new Set((suite.inline ?? []).map((profile) => profile.kind));
	for (const kind of inlineKinds) {
		if (!profiled.has(kind))
			problems.push(`inline kind "${kind}" has no profile in the suite's inline`);
	}
	for (const kind of profiled) {
		if (kind !== undefined && !inlineKinds.includes(kind)) {
			problems.push(`inline names kind "${kind}", which these plugins don't declare`);
		}
	}
	return problems;
}

/** Runs one kit, keeping its failure message instead of stopping the run. */
async function collect<T>(run: () => Promise<T>, failures: string[]): Promise<T | null> {
	try {
		return await run();
	} catch (error) {
		failures.push((error as Error).message.replace(/\n/g, '\n    '));
		return null;
	}
}
