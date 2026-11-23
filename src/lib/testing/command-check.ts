/**
 * `check`'s rows over what a plugin runs: each command it lists or its block types place, and each
 * caret menu, by trigger. A row drives the plugin's own code against the editor a check hands it: a
 * command or a pick, with the host loading another note while what it started still runs, and a
 * block's command handed the second of two blocks while the caret sits in the first.
 */

import type { Contribution } from '../schema/plugin-unit';
import { togglesOf } from '../schema/inline-type';
import { isThenable, type ContributedCommand } from '../schema/editor-contributions';
import type { ContributedMenu } from '../schema/caret-menu';
import type { AnyBlockKind } from '../core/nodes';
import type { Block } from '../schema/doc-view';
import type { CommandCheck } from './check-names';
import { Unsettled, type PluginCheckRun, type Stage } from './check-context';
import type { Outcome } from './inline-check';

/** The commands `plugin` runs; a mark's toggle is left out, since it is the mark's own. */
export function commandSubjects(
	run: PluginCheckRun,
	plugin: string,
	own: Contribution | undefined
): ContributedCommand[] {
	// Installed, so each toggle's id already names its plugin.
	const toggles = new Set(togglesOf(own?.inlines).map(({ id }) => id));
	return run.contributions.commands.filter(
		(entry) => entry.plugin === plugin && !toggles.has(entry.id)
	);
}

/** `plugin`'s caret menus by trigger, in list order: the first that takes a query opens. */
export function menuSubjects(run: PluginCheckRun, plugin: string): Map<string, ContributedMenu[]> {
	const byTrigger = new Map<string, ContributedMenu[]>();
	for (const entry of run.contributions.menus) {
		if (entry.plugin !== plugin) continue;
		const { trigger } = entry.menu;
		byTrigger.set(trigger, [...(byTrigger.get(trigger) ?? []), entry]);
	}
	return byTrigger;
}

/** The editor the rows that drive a plugin share, as a mounted editor is shared. */
export interface Mount {
	/** `drive` with `source` loaded into that editor. */
	drive(source: string, drive: (stage: Stage) => Promise<Outcome>): Promise<Outcome>;
	/** That editor with `source` loaded, for a row that reads; one of its own where none is mounted. */
	over(source: string): Stage;
	/** Runs the function `setup` returned, once the rows are done; the `setup` row. */
	end(): Outcome;
}

/** One editor over `source` with the plugin's `setup` run on it once. With no DOM and a `setup` to
 *  run, no row can be driven as the plugin was promised. */
export function mount(run: PluginCheckRun, setup: Contribution['setup'], source: string): Mount {
	if (setup && typeof document === 'undefined') {
		const needs = 'needs a DOM: setup runs once an editor is mounted, so it may use one';
		return {
			drive: async () => ({ status: 'unchecked', detail: needs }),
			over: (text) => run.stage(text),
			end: () => ({ status: 'unchecked', detail: needs })
		};
	}
	const stage = run.stage(source);
	let dispose: void | (() => void) = undefined;
	let threw: string | null = null;
	try {
		dispose = setup?.(stage.editor);
	} catch (error) {
		threw = messageOf(error);
	}
	return {
		async drive(text, drive) {
			if (threw !== null) return failed(`its setup threw: ${threw}`);
			stage.load(text);
			try {
				return await drive(stage);
			} catch (error) {
				if (!(error instanceof Unsettled)) return failed(`threw: ${messageOf(error)}`);
				return { status: 'failed', detail: error.message, unsettled: true };
			}
		},
		over: (text) => (stage.load(text), stage),
		end() {
			if (!setup) return { status: 'not-applicable', detail: 'lists no setup' };
			if (threw !== null) return failed(`threw: ${threw}`);
			try {
				if (typeof dispose === 'function') dispose();
				return { status: 'passed', detail: 'ran, and so did the function it returned' };
			} catch (error) {
				return failed(`threw: ${messageOf(error)}`);
			}
		}
	};
}

/** `waitingWrite` and `actionTarget` over `entry`, each answered before the next is driven; a
 *  command its block types place is handed a block of the first of them with a sample. */
export async function* commandOutcomes(
	run: PluginCheckRun,
	entry: ContributedCommand,
	mounted: Mount
): AsyncGenerator<[CommandCheck, Outcome]> {
	const placing = placingSample(run, entry);
	if (entry.placedBy.size > 0 && !placing) {
		const none: Outcome = {
			status: 'not-applicable',
			detail: 'no block type placing it has a sample'
		};
		yield ['waitingWrite', none];
		yield ['actionTarget', none];
		return;
	}
	const waiting = await mounted.drive(placing?.sample ?? 'A note.\n', (stage) => {
		const block = placing && blocksOf(stage, placing.kind)[0];
		return waitingCommand(run, stage, entry, block ?? undefined);
	});
	yield ['waitingWrite', waiting];
	const target = placing
		? await mounted.drive(`${placing.sample}\n${placing.sample}`, (stage) =>
				actionTarget(run, stage, entry, placing.kind)
			)
		: { status: 'not-applicable' as const, detail: 'takes no block, so none is handed to it' };
	yield ['actionTarget', target];
}

/** `waitingWrite` over the menus sharing `trigger`: each picks its first row for an empty query. */
export async function menuOutcome(
	trigger: string,
	menus: readonly ContributedMenu[],
	mounted: Mount
): Promise<Outcome> {
	const outcomes: Outcome[] = [];
	for (const { menu } of menus) {
		const outcome = await mounted.drive(`${trigger}\n`, (stage) => waitingPick(stage, menu));
		const named =
			menus.length > 1 ? { ...outcome, detail: `${menu.label}: ${outcome.detail}` } : outcome;
		outcomes.push(named);
	}
	// A menu that did not settle first, since no excuse covers the row; then failed where any failed,
	// else passed where any held, as a block type's samples fold.
	const unsettled = outcomes.find((outcome) => outcome.unsettled);
	if (unsettled) return unsettled;
	for (const status of ['failed', 'passed', 'unchecked'] as const) {
		const found = outcomes.find((outcome) => outcome.status === status);
		if (found) return found;
	}
	return outcomes[0];
}

// ── Internal ─────────────────────────────────────────────────────────────────

const NOTE_LINE = 'Another note.\n';

/** The note a waiting row has the host load while the plugin waits: no shorter than the `length`
 *  bytes it replaces, so a write at a byte the plugin kept lands in it and is seen. */
const anotherNote = (length: number) =>
	NOTE_LINE.repeat(Math.max(1, Math.ceil(length / NOTE_LINE.length)));

const failed = (detail: string): Outcome => ({ status: 'failed', detail });
const messageOf = (error: unknown) => (error as Error)?.message ?? String(error);

function placingSample(run: PluginCheckRun, entry: ContributedCommand) {
	for (const kind of entry.placedBy) {
		const sample = run.context.descriptor(kind as AnyBlockKind).samples?.[0];
		if (sample !== undefined) return { kind, sample };
	}
	return null;
}

const blocksOf = (stage: Stage, kind: string) =>
	stage.editor.doc.blocks.filter((block) => block.type.name === kind);

async function waitingCommand(
	run: PluginCheckRun,
	stage: Stage,
	entry: ContributedCommand,
	block: Block | undefined
): Promise<Outcome> {
	// In the block it is handed, else in the note: a command that acts at the caret finds one.
	stage.caret(block?.from ?? 0);
	if (!run.contributions.can(entry, block)) {
		return { status: 'not-applicable', detail: 'its `when` declines the sample' };
	}
	return outlives(stage, entry.spec.run(stage.editor, block), 'it');
}

async function waitingPick(stage: Stage, menu: ContributedMenu['menu']): Promise<Outcome> {
	// Where typing the trigger leaves it.
	stage.caret(menu.trigger.length);
	const ctx = { editor: stage.editor };
	const rows =
		menu.accepts && !menu.accepts('', ctx)
			? []
			: await stage.within(menu.rows('', ctx), 'its rows for an empty query');
	if (rows.length === 0) {
		return {
			status: 'not-applicable',
			detail: 'lists no row for an empty query, so none is picked'
		};
	}
	const row = rows[0];
	const label = (row as { label?: unknown })?.label;
	const picked = typeof label === 'string' ? `its pick of "${label}"` : 'its first pick';
	const pick = stage.pick(menu.trigger, '');
	try {
		return await outlives(stage, menu.pick(row, pick), picked);
	} finally {
		pick.end();
	}
}

/** Loads another note once the call's own writes through the editor are done, as a host's load
 *  waits for an open write, then fails any write made after it, before or after `answer` settles. */
async function outlives(stage: Stage, answer: unknown, what: string): Promise<Outcome> {
	if (stage.busy()) await stage.idle(what);
	const before = stage.writes.length;
	stage.swap(anotherNote(stage.source().length));
	const rejected = await ended(stage, answer, what);
	const waits = isThenable(answer);
	const late = stage.writes.slice(before);
	if (late.length > 0) {
		const advice = waits
			? 'after the host loaded another note; write through a draft opened before the wait, ' +
				'which is refused once its note is gone'
			: 'after it returned, once the host loaded another note: return the promise of what it ' +
				'waits on, and write through a draft opened before the wait';
		return failed(`${what} made ${late.join(', ')} ${advice}`);
	}
	if (rejected) {
		return failed(
			`${what} rejected once the host loaded another note: ${messageOf(rejected.cause)}`
		);
	}
	if (!waits) {
		return {
			status: 'not-applicable',
			detail: `${what} answers at once, with no wait to outlive a note`
		};
	}
	return { status: 'passed', detail: `${what} waited, and wrote nothing into the next note` };
}

// The timer as this module loaded it, so a test's fake timers can't hold the turn; marked pure, or
// a host importing `configureEditorEnv` from `/testing` ships the call (G4.375).
const unfaked = { setTimeout: /* @__PURE__ */ globalThis.setTimeout.bind(globalThis) };

/** Waits out a call: `answer` within the bound, its writes, then one macrotask, so a write or a
 *  report it left running lands on its own row. Answers the promise's rejection. */
async function ended(
	stage: Stage,
	answer: unknown,
	what: string
): Promise<{ cause: unknown } | null> {
	let rejected: { cause: unknown } | null = null;
	try {
		if (isThenable(answer)) await stage.within(answer, what);
	} catch (cause) {
		if (cause instanceof Unsettled) throw cause;
		rejected = { cause };
	}
	await stage.idle(what);
	await new Promise<void>((resolve) => unfaked.setTimeout(resolve, 0));
	await stage.idle(what);
	return rejected;
}

/** Runs `entry` on the second of two blocks of `kind` with the caret in the first. */
async function actionTarget(
	run: PluginCheckRun,
	stage: Stage,
	entry: ContributedCommand,
	kind: string
): Promise<Outcome> {
	const blocks = blocksOf(stage, kind);
	if (blocks.length < 2) {
		return { status: 'not-applicable', detail: 'two samples in a row read as one block' };
	}
	const [first, second] = [blocks[0], blocks[blocks.length - 1]];
	const before = stage.source();
	const kept = before.slice(0, first.to);
	stage.caret(first.from);
	if (!run.contributions.can(entry, second)) {
		return { status: 'not-applicable', detail: 'its `when` declines the sample' };
	}
	const rejected = await ended(stage, entry.spec.run(stage.editor, second), 'it');
	if (rejected) return failed(`threw: ${messageOf(rejected.cause)}`);
	const inserted = stage.writes.find((write) => write.startsWith('an insert'));
	if (!stage.source().startsWith(kept) || inserted) {
		const how = inserted ? `made ${inserted} at the caret` : 'wrote the first block';
		return failed(`handed the second block, it ${how}, where the caret was`);
	}
	if (stage.source() !== before) {
		return { status: 'passed', detail: 'wrote the block it was handed, not the one at the caret' };
	}
	if (stage.screen.length > 0) {
		const asked = [...new Set(stage.screen)].join(', ');
		return {
			status: 'unchecked',
			detail: `needs a browser: it asked ${asked}, which only a mounted editor answers`
		};
	}
	return { status: 'not-applicable', detail: 'wrote nothing on the sample' };
}
