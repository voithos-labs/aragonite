/**
 * `check(plugin)`: every check over every sample of every block type and inline construct a plugin
 * value lists, read the way the plugin's own editor reads it, answered as one row per subject and
 * check. A failing row,
 * or a dev warning, rejects the call with a `CheckFailure`, so a call nobody asserts on still fails
 * its test. Which checks run, and which an author may excuse, is `check-names.ts`.
 */

import { devChecksOn, setDevWarnSink } from '@voithos-labs/aragonite/dev-checks';
import type { AnyBlockKind } from '../core/nodes';
import { splitLines } from '../core/lines';
import { makingOf } from '../schema/block-type';
import { isPluginValue, THIS_COPY, type Plugin, type PluginError } from '../schema/plugin-unit';
import { qualifiedName } from '../schema/plugin-name';
import { pluginCheckContext, type CheckContext, type PluginCheckRun } from './check-context';
import {
	CHECKS,
	contractOf,
	isCheckName,
	type BlockCheck,
	type CheckName,
	type CommandCheck,
	type ContainerCheck,
	type Excused,
	type InlineCheck,
	type MenuCheck,
	type PluginCheck,
	type RewriteCheck
} from './check-names';
import { blockReadOutcomes } from './block-reads';
import {
	commandOutcomes,
	commandSubjects,
	menuOutcome,
	menuSubjects,
	mount
} from './command-check';
import { assertReasonDocumented, settleCells, show, type SettledCell } from './conformance-core';
import { CONTAINER_CONFORMANCE_CELLS } from './container-conformance';
import { CONTAINER_DECLARED, derivedProfile } from './container-shape';
import { inlineOutcomes, inlineSubjects, type Outcome } from './inline-check';
import { paintOutcomes } from './paint-check';
import {
	pasteRewriteOutcome,
	pasteRewritesOf,
	rewriteOutcome,
	rewriteSubjects
} from './rewrite-check';
import { checkOneLineBreak, settleKindCells, type KindCell } from './kind-conformance';

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
	if (!isPluginValue(plugin)) {
		throw new Error(
			'check: its first argument is no plugin value: hand it what definePlugin returned, ' +
				'calling a function that makes one first'
		);
	}
	if (!devChecksOn) {
		throw new Error(
			`check(${plugin.name}): dev checks are off, so a contract warning would pass unseen; call ` +
				'configureEditorEnv({ isDev: true }) from @voithos-labs/aragonite/testing first'
		);
	}
	const { timeout } = options;
	if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0)) {
		throw new Error(`check(${plugin.name}): \`timeout\` is a positive number of milliseconds`);
	}
	const warnings: { tag: string; message: string }[] = [];
	const previous = setDevWarnSink(({ tag, message }) => warnings.push({ tag, message }));
	let found: Row[];
	try {
		found = await rowsOf(plugin, options, warnings);
	} finally {
		setDevWarnSink(previous);
	}
	const rows = excused(found, options.excuse, plugin.name).map(
		({ unsettled: _, ...row }): CheckRow => row
	);
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
	/** How long each wait of the plugin's may last, in milliseconds, before its row fails: a command's
	 *  or a pick's promise, a menu's `rows`, a highlighter's answer. Default 2000. */
	timeout?: number;
}

export type CheckStatus =
	'passed' | 'failed' | 'advisory' | 'excused' | 'not-applicable' | 'unchecked';

export interface CheckRow {
	readonly of: 'plugin' | 'block' | 'inline' | 'command' | 'menu' | 'pasteRewrite' | 'blockRewrite';
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
 *  doesn't apply, that no excuse covers or whose wait did not settle, or over a subject the plugin
 *  doesn't list, the run fails. */
export interface Excuses {
	readonly plugin?: Excused<PluginCheck>;
	readonly blocks?: { readonly [local: string]: Excused<BlockCheck | ContainerCheck> };
	readonly inlines?: { readonly [local: string]: Excused<InlineCheck> };
	/** By the command's own id; a block action's row is its command's. */
	readonly commands?: { readonly [id: string]: Excused<CommandCheck> };
	/** By trigger; menus sharing one are one subject. */
	readonly menus?: { readonly [trigger: string]: Excused<MenuCheck> };
	/** By the rewrite's own name. */
	readonly pasteRewrites?: { readonly [name: string]: Excused<RewriteCheck> };
	/** By the full name of the type rewritten (`paragraph`, `alerts/alert`). */
	readonly blockRewrites?: { readonly [type: string]: Excused<RewriteCheck> };
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

type Warnings = readonly { tag: string; message: string }[];

/** A row as the excuses read it: whether its wait settled is theirs alone. */
type Row = CheckRow & Pick<Outcome, 'unsettled'>;

async function rowsOf(
	plugin: Plugin<object>,
	options: CheckOptions<object>,
	warnings: Warnings
): Promise<Row[]> {
	// What the editor reports for the plugin, taken by the row it was heard in.
	const said: string[] = [];
	const { row, run } = install(plugin, options, warnings, said);
	if (!run) return [row];
	try {
		const rows: Row[] = [row];
		const push = (of: CheckRow['of'], subject: string, check: CheckName, outcome: Outcome) =>
			rows.push({ of, subject, check, ...heard(outcome, said) });
		const own = run.units.find((unit) => unit.name === plugin.name)?.contribution;
		// A type the install left out is in `install`'s row, and nowhere else; a title row is checked
		// with its container.
		const listed = new Set(own?.blocks?.map((type) => type.name));
		const kinds = run.kinds.filter(
			(kind) => kind.startsWith(`${plugin.name}/`) && listed.has(kind)
		);
		for (const kind of kinds) {
			const type = own?.blocks?.find((each) => each.name === kind);
			const kindRows = await blockRows(run.context, kind, type && makingOf(type)?.oneLine);
			for (const row of kindRows) rows.push(row);
			if (kindRows[0].status === 'failed') continue;
			const samples = run.context.descriptor(kind).samples ?? [];
			for (const [check, outcome] of await blockReadOutcomes(run, own, kind, samples)) {
				push('block', kind, check, outcome);
			}
		}
		for (const subject of inlineSubjects(own?.inlines, run.inlines)) {
			for (const [check, outcome] of inlineOutcomes(run, subject)) {
				push('inline', subject.name, check, outcome);
			}
		}
		const samples = kinds.flatMap((kind) => run.context.descriptor(kind).samples ?? []);
		// One editor for the rest, as a mounted editor is: `setup` runs on it once, before them.
		const mounted = mount(run, own?.setup, samples.join('\n'));
		let setup: Outcome;
		try {
			for (const entry of commandSubjects(run, plugin.name, own)) {
				for await (const [check, outcome] of commandOutcomes(run, entry, mounted)) {
					push('command', entry.id, check, outcome);
				}
			}
			for (const [trigger, menus] of menuSubjects(run, plugin.name)) {
				push('menu', trigger, 'waitingWrite', await menuOutcome(trigger, menus, mounted));
			}
			for (const entry of pasteRewritesOf(run, plugin.name)) {
				const subject = qualifiedName(plugin.name, entry.rewrite.name);
				push('pasteRewrite', subject, 'rewriteLands', pasteRewriteOutcome(run, mounted, entry));
			}
			for (const [from, entries] of rewriteSubjects(run, plugin.name)) {
				push('blockRewrite', from, 'rewriteLands', rewriteOutcome(run, mounted, from, entries));
			}
			const painted = await paintOutcomes(run, mounted, plugin.name, own, warnings);
			for (const [check, outcome] of painted) push('plugin', plugin.name, check, outcome);
		} finally {
			setup = mounted.end();
		}
		push('plugin', plugin.name, 'setup', setup);
		return rows.map(advisory);
	} finally {
		run.release();
	}
}

/** `outcome`, failed where the editor reported the plugin while its row ran: a throw the editor
 *  contains (a `when`, a rewrite's `into`) otherwise reads to the row as a decline. */
function heard(outcome: Outcome, said: string[]): Outcome {
	if (said.length === 0) return outcome;
	const reported = `the editor reported your plugin (${said.splice(0).join('; ')})`;
	const detail = outcome.status === 'failed' ? `${outcome.detail}; ${reported}` : reported;
	return { ...outcome, status: 'failed', detail };
}

/** `install`: the plugin with its defaults and with `options`, held at once as two editors would
 *  hold them, so a fact that differs by option warns. No run comes back where installing threw. */
function install(
	plugin: Plugin<object>,
	{ options, warningsFail, timeout }: CheckOptions<object>,
	warnings: Warnings,
	said: string[]
): { row: CheckRow; run: PluginCheckRun | null } {
	const text = ({ doing, cause }: PluginError) => `${doing}: ${messageOf(cause)}`;
	const report = (error: PluginError) => said.push(text(error));
	// What the defaults alone are told, apart from what the options handed are told.
	const bare: PluginError[] = [];
	const before = warnings.length;
	let run: PluginCheckRun | null = null;
	try {
		const alone = options ? (error: PluginError) => bare.push(error) : report;
		const defaults = pluginCheckContext([plugin], alone, timeout);
		try {
			run = options ? pluginCheckContext([plugin(options)], report, timeout) : defaults;
		} finally {
			if (run !== defaults) defaults.release();
		}
	} catch (error) {
		said.push(`installing threw: ${messageOf(error)}`);
	}
	// A required option has no valid default: once the plugin's own `validate` refuses the defaults,
	// all they are told is said, not failed, with the option handed.
	const refusedAlone = bare.some(({ doing }) => doing === 'validate');
	const refused = refusedAlone ? bare.map(text) : [];
	const problems = [...(refusedAlone ? [] : bare.map(text)), ...said.splice(0)];
	if (warningsFail !== false) {
		for (const { tag, message } of warnings.slice(before))
			problems.push(`dev warning [${tag}]: ${message}`);
	}
	const unheld =
		refused.length > 0 ? [`its defaults alone are refused (${refused.join('; ')})`] : [];
	const held =
		options && unheld.length === 0 ? 'its defaults and with your options' : 'your options';
	const passed = options ? [`installs with ${held}`, ...unheld].join('; ') : 'installs';
	const detail = problems.length > 0 ? [...problems, ...unheld].join('; ') : passed;
	const status = problems.length > 0 ? 'failed' : 'passed';
	return { row: { of: 'plugin', subject: plugin.name, check: 'install', status, detail }, run };
}

const messageOf = (error: unknown) => (error as Error)?.message ?? String(error);

/** `sample`, then every block and container check over each sample that reads as the type, one row
 *  per check across the samples; `oneLine` says which lines are a whole one-line block. */
async function blockRows(
	context: CheckContext,
	kind: AnyBlockKind,
	oneLine?: (line: string) => boolean
): Promise<CheckRow[]> {
	const descriptor = context.descriptor(kind);
	const samples = descriptor.samples ?? [];
	const problems = samples.map((sample) => sampleProblem(context, kind, sample));
	const onOneLine = samples.map((sample) => oneLine?.(splitLines(sample)[0].text) ?? false);
	const sampleRow: Outcome =
		samples.length === 0
			? { status: 'failed', detail: 'lists no sample: give `sample` the Markdown the checks drive' }
			: problems.some((problem) => problem !== null)
				? { status: 'failed', detail: problems.filter((p) => p !== null).join('; ') }
				: oneLine && !onOneLine.includes(true)
					? {
							status: 'failed',
							detail: 'its block may sit on one line, but no sample is one line: add one that is'
						}
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
			for (const [check, outcome] of blockOutcomes(cell)) {
				const breaks = check === 'rawWrite' && onOneLine[at];
				note(check, breaks ? withOneLineBreak(context, kind, sample, outcome) : outcome, at);
			}
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

// A one-line sample's `rawWrite` drives one write more: a line break typed into its text.
function withOneLineBreak(
	context: CheckContext,
	kind: AnyBlockKind,
	sample: string,
	outcome: Outcome
): Outcome {
	if (outcome.status !== 'passed') return outcome;
	try {
		checkOneLineBreak(context, kind, sample);
	} catch (error) {
		return { status: 'failed', detail: messageOf(error) };
	}
	return {
		...outcome,
		detail: `${outcome.detail}; a line break typed into its one line splits it`
	};
}

function sampleProblem(context: CheckContext, kind: AnyBlockKind, sample: string): string | null {
	const first = context.parse(sample).children[0];
	if (first?.kind === kind) return null;
	return `${show(sample)} reads as ${first ? `a "${first.kind}"` : 'nothing'} first, not as "${kind}"`;
}

type ContainerCell =
	| 'localIndex'
	| 'ancestry'
	| 'focusBubble'
	| 'openerLine'
	| 'copyMarkers'
	| 'terminatorCollision'
	| 'titleRow';
const CONTAINER_CELLS = new Set<string>([
	'localIndex',
	'ancestry',
	'focusBubble',
	'openerLine',
	'copyMarkers',
	'terminatorCollision',
	'titleRow'
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
const advisory = (row: Row): Row =>
	row.status === 'failed' && CHECKS[row.check].advisory ? { ...row, status: 'advisory' } : row;

/* -------------------------------------------------------------------------- */
/*                                  Excuses                                   */
/* -------------------------------------------------------------------------- */

/** `rows` with each excuse applied, and a failed row for each excuse that doesn't stand. */
function excused(rows: Row[], excuse: Excuses | undefined, plugin: string): Row[] {
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
	// A command and a whole-paste rewrite are named after their plugin as a type is; a trigger and a
	// rewritten type's full name are spelled as the author wrote them.
	for (const [of, space, named] of [
		['block', excuse?.blocks, true],
		['inline', excuse?.inlines, true],
		['command', excuse?.commands, true],
		['menu', excuse?.menus, false],
		['pasteRewrite', excuse?.pasteRewrites, true],
		['blockRewrite', excuse?.blockRewrites, false]
	] as const) {
		for (const [local, checks] of Object.entries(space ?? {})) {
			const subject = named ? qualifiedName(plugin, local) : local;
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
			// A refused excuse over a failure keeps the failure, or the author fixes the excuse blind.
			const found = out[at]?.status === 'failed' ? ` (it found: ${out[at].detail})` : '';
			const row: CheckRow = {
				of: claim.of,
				subject: claim.subject ?? claim.local,
				check: claim.check as CheckName,
				status: 'failed',
				detail: `excused, but ${detail}${found}`
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
	out: Row[],
	at: number,
	reason: string,
	refused: (detail: string) => void
): void {
	const row = out[at];
	// A row whose wait never settled was never driven to its end, so nothing it found is excused.
	if (row.unsettled) refused('an excuse does not cover a wait that did not settle');
	else if (row.status === 'failed' || row.status === 'advisory') {
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
			const contract = contractOf(check, of);
			const breaks = contract
				? `\n    breaks: ${contract.promise} (plugin-testing.md#${contract.anchor})`
				: '';
			return `${of} ${subject} ${check}: ${detail}${breaks}`;
		});
	for (const { tag, message } of report.warnings) lines.push(`dev warning [${tag}]: ${message}`);
	return `check failed for plugin '${report.plugin}':\n  - ${lines.join('\n  - ')}`;
}
