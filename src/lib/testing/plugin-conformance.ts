/**
 * The whole-plugin conformance run for `setup` plugins: install them on a blank platform, then hold
 * every block and inline kind their setups declared to the kits. A plugin listing runs it over a
 * suite of them, so a kind can't pass by being left out: a container or inline kind needs its
 * profile. A plugin value is `check`'s.
 */

import { devChecksOn, setDevWarnSink, type DevWarnEntry } from '@voithos-labs/aragonite/dev-checks';
import type { AnyBlockKind } from '../core/nodes';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import {
	installPlugins,
	normalizePluginEntries,
	type EditorPlugin
} from '../schema/plugin-install';
import type { PluginList } from '../schema/plugin-unit';
import type { CheckStatus } from './check';
import type { CellReport, SettledCell } from './conformance-core';
import {
	declaredPluginInlineKind,
	pluginInlineKindsDeclaredBy,
	pluginKindsDeclaredBy
} from '../schema/plugin-kind';
import { defaultCheckContext } from './check-context';
import {
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
	/** Every cell as a row, the way `check` reports one; a failed run's error carries them too. */
	rows: LegacyRow[];
}

/** A cell as a row; its `check` is the kit's cell name, which `CheckName` doesn't list. */
export interface LegacyRow {
	of: 'plugin' | 'block' | 'inline';
	subject: string;
	check: string;
	status: CheckStatus;
	detail: string;
}

/** Every kit over every kind the suite declares; throws one `Error`, carrying `rows` and `warnings`,
 *  naming each failed cell, unprofiled kind, plugin value (`check`'s) and dev warning. */
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
	const report: PluginConformanceReport = {
		plugins: names,
		kinds: [],
		containers: [],
		inline: [],
		rows: []
	};
	const suiteFailure = (detail: string) => {
		failures.push(detail);
		report.rows.push({
			of: 'plugin',
			subject: names.join(', '),
			check: 'suite',
			status: 'failed',
			detail
		});
	};
	try {
		resetPluginPlatformForTests();
		const { plugins, values } = normalizePluginEntries(suite.plugins);
		for (const { name } of values) {
			suiteFailure(
				`"${name}" is a plugin value: check it with check(plugin) from @voithos-labs/aragonite/testing`
			);
		}
		const quiet = warnings.length;
		installPlugins(plugins);
		// A suite declaring no kind still drove the install, so a passed run never holds no row.
		if (plugins.length > 0) {
			const noisy = warnings.length > quiet;
			report.rows.push({
				of: 'plugin',
				subject: names.join(', '),
				check: 'install',
				status: noisy ? 'failed' : 'passed',
				detail: noisy ? 'raised a dev warning while installing' : 'installs'
			});
		}
		const blockKinds: AnyBlockKind[] = names.flatMap(pluginKindsDeclaredBy);
		const inlineKinds = names.flatMap(pluginInlineKindsDeclaredBy);
		for (const problem of missingProfiles(suite, blockKinds, inlineKinds)) suiteFailure(problem);

		const kit = async <R extends { cells: CellReport[] }>(
			of: LegacyRow['of'],
			subject: string,
			run: () => Promise<R>
		): Promise<R | null> => {
			const { ran, cells, thrown } = await collect(run, failures);
			for (const cell of cells) report.rows.push(legacyRow(of, subject, cell));
			if (thrown && !cells.some((cell) => cell.status === 'failed')) {
				report.rows.push({ of, subject, check: 'suite', status: 'failed', detail: thrown });
			}
			return ran;
		};
		for (const kind of blockKinds) {
			const ran = await kit('block', kind, () => runKindConformance(kind));
			if (ran) report.kinds.push(ran);
			const profile = suite.containers?.[kind];
			if (!profile || !getBlockKindDescriptor(kind).isContainer) continue;
			const container = await kit('block', kind, () => runContainerConformance(kind, profile));
			if (container) report.containers.push(container);
		}
		for (const { kind, ...profile } of suite.inline ?? []) {
			const inlineProfile: InlineConformanceProfile =
				kind === undefined ? profile : { ...profile, kind: declaredPluginInlineKind(kind) };
			const subject = kind ?? profile.prefix ?? profile.trigger;
			const inline = await kit('inline', subject, () => runInlineKindConformance(inlineProfile));
			if (inline) report.inline.push(inline);
		}
	} catch (error) {
		suiteFailure((error as Error).message);
	} finally {
		setDevWarnSink(previousSink);
	}
	for (const { tag, message } of warnings) failures.push(`dev warning [${tag}]: ${message}`);
	if (failures.length > 0) {
		const carried = {
			rows: report.rows,
			warnings: warnings.map(({ tag, message }) => ({ tag, message }))
		};
		throw Object.assign(new Error(`${heading}:\n  - ${failures.join('\n  - ')}`), carried);
	}
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

/** Runs one kit, keeping its failure message and its settled cells instead of stopping the run. */
async function collect<T extends { cells: CellReport[] }>(
	run: () => Promise<T>,
	failures: string[]
): Promise<{ ran: T | null; cells: readonly SettledCell[]; thrown?: string }> {
	try {
		const ran = await run();
		return { ran, cells: ran.cells };
	} catch (error) {
		const { message, cells = [] } = error as Error & { cells?: SettledCell[] };
		failures.push(message.replace(/\n/g, '\n    '));
		return { ran: null, cells, thrown: message };
	}
}

const LEGACY_STATUS: Record<SettledCell['status'], CheckStatus> = {
	asserted: 'passed',
	exempt: 'not-applicable',
	boundary: 'unchecked',
	failed: 'failed'
};

function legacyRow(of: LegacyRow['of'], subject: string, cell: SettledCell): LegacyRow {
	return {
		of,
		subject,
		check: cell.cell,
		status: LEGACY_STATUS[cell.status],
		detail: cell.detail ?? ''
	};
}
