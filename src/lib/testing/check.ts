/**
 * `check(plugin)`: every check over every sample of every block type a plugin value lists, read the
 * way the plugin's own editor reads it, answered as one row per subject and check. A failing row,
 * or a dev warning, rejects the call with a `CheckFailure`, so a call nobody asserts on still fails
 * its test. Which checks run, and which an author may excuse, is `check-names.ts`.
 */

import { devChecksOn, setDevWarnSink } from '@voithos-labs/aragonite/dev-checks';
import type { AnyBlockKind } from '../core/nodes';
import {
	THIS_COPY,
	type Contribution,
	type Editor,
	type Plugin,
	type PluginError
} from '../schema/plugin-unit';
import { qualifiedName } from '../schema/plugin-name';
import { pluginCheckContext, type CheckContext, type PluginCheckRun } from './check-context';
import {
	CHECKS,
	isCheckName,
	type BlockCheck,
	type CheckName,
	type ContainerCheck,
	type Excused,
	type InlineCheck,
	type PluginCheck
} from './check-names';
import { assertReasonDocumented, settleCells, show, type SettledCell } from './conformance-core';
import { CONTAINER_CONFORMANCE_CELLS } from './container-conformance';
import { CONTAINER_DECLARED, derivedProfile } from './container-shape';
import { settleKindCells, type KindCell } from './kind-conformance';

/* -------------------------------------------------------------------------- */
/*                                 Public API                                 */
/* -------------------------------------------------------------------------- */

export type { CheckName } from './check-names';

/** Runs every check over `plugin`, with `options` laid over its own; rejects with a
 *  {@link CheckFailure}. Needs dev checks on, and no DOM. */
export async function check<O extends object>(
	plugin: Plugin<O>,
	options: CheckOptions<O> = {}
): Promise<CheckReport> {
	if (!devChecksOn) {
		throw new Error(
			`check(${plugin.name}): dev checks are off, so a contract warning would pass unseen; call ` +
				'configureEditorEnv({ isDev: true }) from @voithos-labs/aragonite/testing first'
		);
	}
	const warnings: { tag: string; message: string }[] = [];
	const previous = setDevWarnSink(({ tag, message }) => warnings.push({ tag, message }));
	let rows: CheckRow[];
	try {
		rows = await rowsOf(plugin, options, warnings);
	} finally {
		setDevWarnSink(previous);
	}
	rows = excused(rows, options.excuse, plugin.name);
	const report: CheckReport = {
		plugin: plugin.name,
		version: plugin.version,
		editor: THIS_COPY.version,
		rows,
		warnings
	};
	const failed = rows.some((row) => row.status === 'failed');
	if (failed || (options.warningsFail !== false && warnings.length > 0)) {
		throw new CheckFailure(report);
	}
	return report;
}

export interface CheckOptions<O extends object> {
	/** Laid over the plugin's own for every check; `install` also installs it without them. */
	options?: Partial<O>;
	excuse?: Excuses;
	/** A dev warning raised during the run fails it. Default true. */
	warningsFail?: boolean;
}

export type CheckStatus =
	'passed' | 'failed' | 'advisory' | 'excused' | 'not-applicable' | 'unchecked';

export interface CheckRow {
	readonly of: 'plugin' | 'block' | 'inline' | 'command' | 'menu' | 'rewrite';
	/** The name the author wrote: the plugin's, a type's qualified name, `plugin/id`, a trigger. */
	readonly subject: string;
	readonly check: CheckName;
	readonly status: CheckStatus;
	readonly detail: string;
}

export interface CheckReport {
	readonly plugin: string;
	readonly version: string;
	readonly editor: string;
	readonly rows: readonly CheckRow[];
	readonly warnings: readonly { readonly tag: string; readonly message: string }[];
}

/** An excuse covers a failing check with a reason of a sentence; over a check that passed, that
 *  doesn't apply or that no excuse covers, or a subject the plugin doesn't list, the run fails. */
export interface Excuses {
	readonly plugin?: Excused<PluginCheck>;
	readonly blocks?: { readonly [local: string]: Excused<BlockCheck | ContainerCheck> };
	readonly inlines?: { readonly [local: string]: Excused<InlineCheck> };
}

/** A package's `./conformance` default export: the plugin value itself, not a call of it. */
export interface Conformance<O extends object = object> {
	plugin: Plugin<O>;
	options?: Partial<O>;
	excuse?: Excuses;
}

// Every copy of the entry marks its failures under one shared key.
const FAILURE = Symbol.for('@voithos-labs/aragonite:check-failure');

/** What `check` rejects with: the report, and a message naming each failed row. */
export class CheckFailure extends Error {
	readonly report: CheckReport;
	constructor(report: CheckReport) {
		super(failureMessage(report));
		this.name = 'CheckFailure';
		this.report = report;
		Object.defineProperty(this, FAILURE, { value: true });
	}
}

/** Reads a marker, not `instanceof`: it narrows across two copies of the entry. */
export function isCheckFailure(error: unknown): error is CheckFailure {
	return typeof error === 'object' && error !== null && FAILURE in error;
}

/* -------------------------------------------------------------------------- */
/*                                  The rows                                  */
/* -------------------------------------------------------------------------- */

type Outcome = { status: 'passed' | 'failed' | 'not-applicable' | 'unchecked'; detail: string };

type Warnings = readonly { tag: string; message: string }[];

async function rowsOf(
	plugin: Plugin<object>,
	options: CheckOptions<object>,
	warnings: Warnings
): Promise<CheckRow[]> {
	const { row, run } = install(plugin, options, warnings);
	if (!run) return [row];
	try {
		const rows: CheckRow[] = [row];
		const own = run.units.find((unit) => unit.name === plugin.name)?.contribution;
		// A type the install left out is in `install`'s row, and nowhere else.
		const kinds = run.kinds.filter((kind) => kind.startsWith(`${plugin.name}/`));
		for (const kind of kinds) for (const row of await blockRows(run.context, kind)) rows.push(row);
		const samples = kinds.flatMap((kind) => run.context.descriptor(kind).samples ?? []);
		rows.push(setupRow(plugin.name, own?.setup, () => run.editor(samples.join('\n'))));
		return rows.map(advisory);
	} finally {
		run.release();
	}
}

/** `install`: the plugin with its defaults and with `options`, held at once as two editors would
 *  hold them, so a fact that differs by option warns. No run comes back where installing threw. */
function install(
	plugin: Plugin<object>,
	{ options, warningsFail }: CheckOptions<object>,
	warnings: Warnings
): { row: CheckRow; run: PluginCheckRun | null } {
	const problems: string[] = [];
	const report = ({ doing, cause }: PluginError) => problems.push(`${doing}: ${messageOf(cause)}`);
	const before = warnings.length;
	let run: PluginCheckRun | null = null;
	try {
		const defaults = pluginCheckContext([plugin], report);
		try {
			run = options ? pluginCheckContext([plugin(options)], report) : defaults;
		} finally {
			if (run !== defaults) defaults.release();
		}
	} catch (error) {
		problems.push(`installing threw: ${messageOf(error)}`);
	}
	if (warningsFail !== false) {
		for (const { tag, message } of warnings.slice(before))
			problems.push(`dev warning [${tag}]: ${message}`);
	}
	const passed = options ? 'installs with its defaults and with your options' : 'installs';
	const detail = problems.length > 0 ? problems.join('; ') : passed;
	const status = problems.length > 0 ? 'failed' : 'passed';
	return { row: { of: 'plugin', subject: plugin.name, check: 'install', status, detail }, run };
}

/** `setup` with its disposer, against the editor a check hands a plugin; a run with no DOM can't
 *  give it the mounted editor it was promised. */
function setupRow(subject: string, setup: Contribution['setup'], editor: () => Editor): CheckRow {
	const answer = (status: CheckStatus, detail: string): CheckRow => ({
		of: 'plugin',
		subject,
		check: 'setup',
		status,
		detail
	});
	if (!setup) return answer('not-applicable', 'lists no setup');
	if (typeof document === 'undefined') {
		return answer(
			'unchecked',
			'needs a DOM: setup runs once an editor is mounted, so it may use one'
		);
	}
	try {
		const dispose = setup(editor());
		if (typeof dispose === 'function') dispose();
		return answer('passed', 'ran, and so did the function it returned');
	} catch (error) {
		return answer('failed', `threw: ${messageOf(error)}`);
	}
}

const messageOf = (error: unknown) => (error as Error)?.message ?? String(error);

/** `sample`, then every block and container check over each sample that reads as the type, one row
 *  per check across the samples. */
async function blockRows(context: CheckContext, kind: AnyBlockKind): Promise<CheckRow[]> {
	const descriptor = context.descriptor(kind);
	const samples = descriptor.samples ?? [];
	const problems = samples.map((sample) => sampleProblem(context, kind, sample));
	const sampleRow: Outcome =
		samples.length === 0
			? { status: 'failed', detail: 'lists no sample: give `sample` the Markdown the checks drive' }
			: problems.some((problem) => problem !== null)
				? { status: 'failed', detail: problems.filter((p) => p !== null).join('; ') }
				: { status: 'passed', detail: `${samples.length} sample(s) read as the type` };
	const outcomes = new Map<CheckName, Outcome[]>();
	const note = (check: CheckName, outcome: Outcome, at: number) => {
		const named = samples.length > 1 && outcome.status === 'failed';
		const labelled = named
			? { ...outcome, detail: `sample ${at + 1}: ${outcome.detail}` }
			: outcome;
		outcomes.set(check, [...(outcomes.get(check) ?? []), labelled]);
	};
	for (const [at, sample] of samples.entries()) {
		if (problems[at] !== null) continue;
		for (const cell of await settleKindCells(context, kind, sample)) {
			for (const [check, outcome] of blockOutcomes(cell)) note(check, outcome, at);
		}
		if (!descriptor.isContainer) continue;
		for (const cell of await containerCells(context, kind, sample)) {
			note(cell.cell === 'copyMarkers' ? 'containerCopy' : cell.cell, outcomeOf(cell), at);
		}
	}
	const asRow = (check: CheckName, outcome: Outcome): CheckRow => ({
		of: 'block',
		subject: kind,
		check,
		...outcome
	});
	return [
		asRow('sample', sampleRow),
		...[...outcomes].map(([check, list]) => asRow(check, worst(list)))
	];
}

function sampleProblem(context: CheckContext, kind: AnyBlockKind, sample: string): string | null {
	const first = context.parse(sample).children[0];
	if (first?.kind === kind) return null;
	return `${show(sample)} reads as ${first ? `a "${first.kind}"` : 'nothing'} first, not as "${kind}"`;
}

type ContainerCell = 'localIndex' | 'ancestry' | 'focusBubble' | 'openerLine' | 'copyMarkers';
const CONTAINER_CELLS = new Set<string>([
	'localIndex',
	'ancestry',
	'focusBubble',
	'openerLine',
	'copyMarkers'
]);

/** The container cells a maker's type takes, over fixtures derived from `sample`. */
async function containerCells(
	context: CheckContext,
	kind: AnyBlockKind,
	sample: string
): Promise<SettledCell<ContainerCell | 'containerDeclared'>[]> {
	let profile;
	try {
		profile = derivedProfile(context, kind, sample);
	} catch (error) {
		const detail = `its fixtures can't be made from the sample: ${(error as Error).message}`;
		return [...CONTAINER_CELLS, 'containerDeclared'].map((cell) => ({
			cell: cell as ContainerCell,
			status: 'failed',
			detail
		}));
	}
	const cells = [
		...CONTAINER_CONFORMANCE_CELLS.filter((cell) => CONTAINER_CELLS.has(cell.cell)),
		CONTAINER_DECLARED
	];
	return settleCells(cells, { context, kind, profile, sample }, kind) as Promise<
		SettledCell<ContainerCell | 'containerDeclared'>[]
	>;
}

const BROWSER = new Set<string>(['focus', 'selectionPaint', 'reorder', 'simOracle']);

/** A kind cell's rows: search's one cell answers two, since search and its paint are told apart. */
function blockOutcomes(cell: SettledCell<KindCell>): [CheckName, Outcome][] {
	if (cell.cell === 'searchPaint') {
		if (cell.status === 'boundary') {
			const reads = 'search reads an editable block, so it skips nothing here';
			return [
				['search', { status: 'not-applicable', detail: reads }],
				['searchPaint', { status: 'unchecked', detail: `needs a browser: ${cell.detail}` }]
			];
		}
		const unpainted = 'search skips the block, so nothing in it is painted';
		return [
			['search', outcomeOf(cell)],
			['searchPaint', { status: 'not-applicable', detail: unpainted }]
		];
	}
	if (BROWSER.has(cell.cell) && cell.status === 'boundary') {
		return [[cell.cell, { status: 'unchecked', detail: `needs a browser: ${cell.detail}` }]];
	}
	return [[cell.cell, outcomeOf(cell)]];
}

function outcomeOf(cell: SettledCell): Outcome {
	const detail = cell.detail ?? '';
	if (cell.status === 'asserted') return { status: 'passed', detail };
	if (cell.status === 'exempt') return { status: 'not-applicable', detail };
	if (cell.status === 'failed') return { status: 'failed', detail };
	throw new Error(`check: "${cell.cell}" reached no environment it names: ${detail}`);
}

/** One row across a type's samples: failed where any failed, passed where any held. */
function worst(list: readonly Outcome[]): Outcome {
	const failed = list.filter((outcome) => outcome.status === 'failed');
	if (failed.length > 0) {
		return { status: 'failed', detail: failed.map((outcome) => outcome.detail).join('; ') };
	}
	for (const status of ['passed', 'unchecked'] as const) {
		const found = list.find((outcome) => outcome.status === status);
		if (found) return found;
	}
	return list[0];
}

/** A failure of a check this release only reports. */
const advisory = (row: CheckRow): CheckRow =>
	row.status === 'failed' && CHECKS[row.check].advisory ? { ...row, status: 'advisory' } : row;

/* -------------------------------------------------------------------------- */
/*                                  Excuses                                   */
/* -------------------------------------------------------------------------- */

/** `rows` with each excuse applied, and a failed row for each excuse that doesn't stand. */
function excused(rows: CheckRow[], excuse: Excuses | undefined, plugin: string): CheckRow[] {
	const out = [...rows];
	const claims: {
		of: CheckRow['of'];
		local: string;
		subject?: string;
		check: string;
		reason: unknown;
	}[] = [];
	for (const [check, reason] of Object.entries(excuse?.plugin ?? {})) {
		claims.push({ of: 'plugin', local: plugin, subject: plugin, check, reason });
	}
	for (const [of, space] of [
		['block', excuse?.blocks],
		['inline', excuse?.inlines]
	] as const) {
		for (const [local, checks] of Object.entries(space ?? {})) {
			const subject = qualifiedName(plugin, local);
			for (const [check, reason] of Object.entries(checks ?? {})) {
				claims.push({ of, local, subject, check, reason });
			}
		}
	}
	for (const claim of claims) {
		const at = out.findIndex(
			(row) => row.of === claim.of && row.subject === claim.subject && row.check === claim.check
		);
		const refused = (detail: string) => {
			const row: CheckRow = {
				of: claim.of,
				subject: claim.subject ?? claim.local,
				check: claim.check as CheckName,
				status: 'failed',
				detail: `excused, but ${detail}`
			};
			if (at < 0) out.push(row);
			else out[at] = row;
		};
		if (!isCheckName(claim.check)) refused(`no check is named "${claim.check}"`);
		else if (!CHECKS[claim.check].excusable) refused('an excuse never covers this check');
		else if (!out.some((row) => row.of === claim.of && row.subject === claim.subject)) {
			refused(`no check runs on a ${claim.of} named "${claim.local}"`);
		} else if (at < 0) refused(`it never runs on this ${claim.of}`);
		else if (!isSentence(claim.reason)) refused('the reason has to be a sentence');
		else excuseRow(out, at, String(claim.reason), refused);
	}
	return out;
}

function excuseRow(
	out: CheckRow[],
	at: number,
	reason: string,
	refused: (detail: string) => void
): void {
	const row = out[at];
	if (row.status === 'failed' || row.status === 'advisory') {
		out[at] = { ...row, status: 'excused', detail: `${reason} (it found: ${row.detail})` };
	} else if (row.status === 'passed') refused('it passed: drop the excuse');
	else refused(`it doesn't apply here (${row.detail}): drop the excuse`);
}

function isSentence(reason: unknown): boolean {
	try {
		assertReasonDocumented(String(reason ?? ''), 'reason');
		return typeof reason === 'string';
	} catch {
		return false;
	}
}

/* -------------------------------------------------------------------------- */
/*                                The failure                                 */
/* -------------------------------------------------------------------------- */

function failureMessage(report: CheckReport): string {
	const lines = report.rows
		.filter((row) => row.status === 'failed')
		.map(({ of, subject, check, detail }) => {
			const { contract } = CHECKS[check] ?? {};
			const breaks = contract
				? `\n    breaks: ${contract.promise} (plugin-testing.md#${contract.anchor})`
				: '';
			return `${of} ${subject} ${check}: ${detail}${breaks}`;
		});
	for (const { tag, message } of report.warnings) lines.push(`dev warning [${tag}]: ${message}`);
	return `check failed for plugin '${report.plugin}':\n  - ${lines.join('\n  - ')}`;
}
