/**
 * What the plugin values one editor runs contribute: their commands (their marks' toggles among
 * them), by value, by `plugin/id` and by chord, their insert rows (their block types' among them),
 * caret menus, paint and code highlighters. Read from each installed list, so `use` rebuilds it,
 * and reached through the editor's activation, which every command lookup already takes, so no
 * route that runs or lists a command can miss a plugin's.
 *
 * A block type's keys and menu rows place their commands here too: such a command runs on a block
 * whose type places it, the one handed to it or else the nearest at the caret. The plugins' paste
 * rewrites are read here, and answered for a pasted block (`tree-operations/paste/paste-rewrites.ts`).
 */
import type { Contribution, Editor, InstalledPlugin, PluginError } from './plugin-unit';
import { claimCommand, commandSpec, type Command, type CommandSpec } from './plugin-command';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { isMotionChord, normalizeChord } from './keybindings';
import { refusedClaims } from './plugin-claims';
import { insertRowProblem, type InsertRow } from './insert-catalogue';
import { makingOf } from './block-type';
import { qualifiedName } from './plugin-name';
import { nodeOfBlock, type Block } from './doc-view';
import type { DocumentView, NodeView } from '../core/node-views';
import type { PasteRewrite } from './paste-rewrite';
import { togglesOf } from './inline-type';
import type { ContributedMenu } from './caret-menu';
import { iconProblem, type Icon } from '../menu-icons';
import type { BlockAction } from './block-shapes';
import type { ContributedAction } from './selection-action';
import type { CodeHighlighter, CodeLanguage, CodeToken } from './code-highlighter';

export interface ContributedCommand {
	readonly plugin: string;
	/** `plugin/id`. */
	readonly id: string;
	/** The chord as the keymap spells it, or null. */
	readonly chord: string | null;
	readonly spec: CommandSpec<unknown>;
	/** The kinds whose block types place it in their keys or menu rows. */
	readonly placedBy: ReadonlySet<string>;
}

/** A plugin's paste rewrite, as an editor holds it. */
export interface ContributedRewrite {
	readonly plugin: string;
	readonly rewrite: PasteRewrite<unknown>;
}

/** A row of a block type's menu, as an editor holds it. */
export interface ContributedBlockAction {
	/** The row's text over `block`: the command's title where the plugin's label fails. */
	label(block: Block): string;
	readonly icon?: Icon;
	readonly command: ContributedCommand;
}

/** The blocks a placed command runs on; `step`, set over a selection across blocks, runs their
 *  writes as one undo step and keeps the selection. */
export interface PlacingBlocks<B = Block> {
	readonly blocks: readonly B[];
	readonly step?: (run: () => void) => void;
}

export interface EditorContributions {
	command(command: Command<unknown> | string): ContributedCommand | undefined;
	atChord(chord: string): ContributedCommand | undefined;
	/** The command `id` where block type `kind` places it. */
	placedAt(id: string, kind: string): ContributedCommand | undefined;
	/** The rows block type `kind` adds to its menu. */
	blockActions(kind: string): readonly ContributedBlockAction[];
	/** `node`, seen at `path`, as a placed command reads it. */
	blockOf(node: NodeView, path: readonly number[]): Block;
	readonly commands: readonly ContributedCommand[];
	/** Each plugin's rows in list order, ids as `plugin/id`. */
	readonly inserts: readonly InsertRow[];
	/** Each plugin's caret menus, in list order. */
	readonly menus: readonly ContributedMenu[];
	/** Each plugin's selection actions, in list order. */
	readonly selectionActions: readonly ContributedAction[];
	/** The plugins that paint, in list order. */
	readonly paints: readonly { readonly plugin: string; readonly contribution: Contribution }[];
	/** Each plugin's paste rewrites, in list order. */
	readonly rewrites: readonly ContributedRewrite[];
	/** Reads the blocks of `clip`, a clipboard read as blocks, with positions from its start. */
	clipboardBlocks(clip: DocumentView): (node: NodeView, path: readonly number[]) => Block;
	/** `entry`'s Markdown for a pasted `block`; null where it keeps the block or throws, which is
	 *  reported. */
	answer(entry: ContributedRewrite, block: Block): string | null;
	/** Each plugin's code highlighter in list order, guarded. */
	readonly highlighters: readonly ContributedHighlighter[];
	/** Runs a command against its plugin's scoped editor; false where `when` or the command declines.
	 *  A throw counts as run, so the key goes no further, and is reported. */
	run(command: ContributedCommand, arg: unknown): boolean;
	can(command: ContributedCommand, arg: unknown): boolean;
	/** `run` for a key that landed in `block`: over a selection across blocks, on each placing
	 *  block it covers instead. */
	runAtKey(command: ContributedCommand, block: Block | undefined): boolean;
	canAtKey(command: ContributedCommand, block: Block | undefined): boolean;
	/** Reads a freshly installed list, leaving out and reporting each plugin whose contribution is
	 *  unusable or claims what one listed before it holds; returns the plugins kept. */
	read(units: readonly InstalledPlugin[]): InstalledPlugin[];
}

/** A plugin's code highlighter as the editor asks it: a throw or a rejection paints plain and is
 *  reported, one rejection reason once. */
export interface ContributedHighlighter {
	readonly plugin: string;
	languages(): readonly CodeLanguage[];
	highlight(
		body: string,
		language: string
	): readonly CodeToken[] | null | Promise<readonly CodeToken[] | null>;
}

export function createEditorContributions(deps: {
	editorFor(plugin: string): Editor | undefined;
	report(error: PluginError): void;
	/** The nearest block holding the caret whose type is one of `kinds`, or over a selection across
	 *  blocks each covered block's outermost such block, with the step their runs share. */
	blocksAround(kinds: ReadonlySet<string>): PlacingBlocks;
	blockOf(node: NodeView, path: readonly number[]): Block;
	clipboardBlocks: EditorContributions['clipboardBlocks'];
}): EditorContributions {
	let commands: ContributedCommand[] = [];
	let byValue = new Map<Command<unknown>, ContributedCommand>();
	let byId = new Map<string, ContributedCommand>();
	let byChord = new Map<string, ContributedCommand>();
	let actionsByKind = new Map<string, readonly ContributedBlockAction[]>();
	let inserts: readonly InsertRow[] = [];
	let menus: readonly ContributedMenu[] = [];
	let selectionActions: readonly ContributedAction[] = [];
	let paints: EditorContributions['paints'] = [];
	let rewrites: readonly ContributedRewrite[] = [];
	let highlighters: readonly ContributedHighlighter[] = [];

	function guarded<T>(entry: ContributedCommand, fallback: T, call: () => T): T {
		try {
			return call();
		} catch (cause) {
			deps.report({ plugin: entry.plugin, doing: `run ${entry.id}`, cause });
			return fallback;
		}
	}

	function read(units: readonly InstalledPlugin[]): InstalledPlugin[] {
		const usable = units.filter((unit) => {
			const problem =
				commandProblem(unit) ??
				insertProblem(unit) ??
				menuProblem(unit) ??
				actionProblem(unit) ??
				rewriteProblem(unit);
			if (problem) deps.report(installError(unit.name, problem));
			return !problem;
		});
		const refused = refusedClaims(
			usable.map((unit) => ({
				plugin: unit.name,
				claims: {
					chords: chordsOf(unit),
					blockKeys: blockKeysOf(unit, false),
					containerKeys: blockKeysOf(unit, true)
				}
			})),
			deps.report
		);
		const kept = usable.filter((unit) => !refused.has(unit.name));
		const listed = kept.flatMap((unit) => {
			const placed = placementsOf(unit);
			return commandsOf(unit).map(
				(value) => [value, entryOf(unit.name, value, placed.get(value))] as const
			);
		});
		commands = listed.map(([, entry]) => entry);
		byValue = new Map(listed);
		byId = new Map(commands.map((entry) => [entry.id, entry]));
		byChord = new Map(commands.flatMap((entry) => (entry.chord ? [[entry.chord, entry]] : [])));
		actionsByKind = new Map(
			kept.flatMap((unit) =>
				blockTypesOf(unit).map(({ kind, making }) => [
					kind,
					(making.actions ?? []).map(({ label, icon, command }) => {
						const entry = byValue.get(command as Command<unknown>)!;
						return { label: (block: Block) => labelOf(entry, label, block), icon, command: entry };
					})
				])
			)
		);
		for (const { chord, plugin } of commands) {
			if (chord && isMotionChord(chord))
				devWarn(
					'keybindings',
					`plugin '${plugin}' binds "${chord}", which moves the caret on this platform, so it never fires`
				);
		}
		inserts = kept.flatMap((unit) =>
			rowsOf(unit).map((row) => Object.freeze({ ...row, id: `${unit.name}/${row.id}` }))
		);
		menus = kept.flatMap((unit) =>
			(unit.contribution.menus ?? []).map((menu) => ({ plugin: unit.name, menu }))
		);
		selectionActions = kept.flatMap((unit) =>
			(unit.contribution.selectionActions ?? []).map((action) => ({ plugin: unit.name, action }))
		);
		paints = kept.flatMap(({ name, contribution }) =>
			contribution.paint || contribution.paintContainer ? [{ plugin: name, contribution }] : []
		);
		rewrites = kept.flatMap(({ name, contribution }) =>
			(contribution.rewrites ?? []).map((rewrite) => ({ plugin: name, rewrite }))
		);
		highlighters = kept.flatMap(({ name, contribution }) =>
			contribution.code ? [guardedHighlighter(name, contribution.code, deps.report)] : []
		);
		return kept;
	}

	/** What a command runs on: its argument. A placed command takes a block only of a type that
	 *  places it, and with none the blocks around the caret or the selection whose type does. */
	function argumentsOf(entry: ContributedCommand, arg: unknown): PlacingBlocks<unknown> {
		if (entry.placedBy.size === 0) return { blocks: [arg] };
		const kind = kindOfBlock(arg);
		if (kind === undefined) return deps.blocksAround(entry.placedBy);
		return { blocks: entry.placedBy.has(kind) ? [arg] : [] };
	}

	/** A key's block, unless the selection runs across blocks, which decides the blocks itself. */
	function keyed(entry: ContributedCommand, block: Block | undefined): unknown {
		return deps.blocksAround(entry.placedBy).step ? undefined : block;
	}

	function canOne(entry: ContributedCommand, arg: unknown): boolean {
		const editor = deps.editorFor(entry.plugin);
		const { when } = entry.spec;
		return !!editor && (!when || guarded(entry, false, () => when(editor, arg)));
	}

	const can = (entry: ContributedCommand, arg: unknown): boolean =>
		argumentsOf(entry, arg).blocks.some((one) => canOne(entry, one));

	function run(entry: ContributedCommand, arg: unknown): boolean {
		const { blocks, step } = argumentsOf(entry, arg);
		const args = blocks.filter((one) => canOne(entry, one));
		if (!step || args.length === 0) return args.length === 1 && runOne(entry, args[0]);
		// The last block first, so a write that re-reads the block after it leaves the blocks still
		// to run.
		step(() => {
			for (let i = args.length - 1; i >= 0; i--) runOne(entry, args[i]);
		});
		return true;
	}

	function runOne(entry: ContributedCommand, arg: unknown): boolean {
		const editor = deps.editorFor(entry.plugin)!;
		return guarded(entry, true, () => {
			const answer = entry.spec.run(editor, arg);
			if (isThenable(answer)) {
				answer.then(undefined, (cause: unknown) =>
					deps.report({ plugin: entry.plugin, doing: `run ${entry.id}`, cause })
				);
			}
			return answer !== false;
		});
	}

	/** A row's label over `block`; one that throws or answers anything but text reads as its
	 *  command's title, and is reported. */
	function labelOf(entry: ContributedCommand, label: BlockAction<unknown>['label'], block: Block) {
		const fail = (cause: unknown) => {
			deps.report({ plugin: entry.plugin, doing: `label for ${entry.id}`, cause });
			return entry.spec.title;
		};
		let text: unknown;
		try {
			text = typeof label === 'function' ? label(block) : label;
		} catch (cause) {
			return fail(cause);
		}
		return typeof text === 'string'
			? text
			: fail(new TypeError(`its label is a ${typeof text}, not text`));
	}

	function answer(entry: ContributedRewrite, block: Block): string | null {
		const editor = deps.editorFor(entry.plugin);
		if (!editor) return null;
		try {
			const out = entry.rewrite.into(block, { editor });
			return typeof out === 'string' ? out : null;
		} catch (cause) {
			deps.report({ plugin: entry.plugin, doing: 'rewrite paste', cause });
			return null;
		}
	}

	return {
		command: (command) => (typeof command === 'string' ? byId.get(command) : byValue.get(command)),
		atChord: (chord) => byChord.get(chord),
		placedAt(id, kind) {
			const entry = byId.get(id);
			return entry?.placedBy.has(kind) ? entry : undefined;
		},
		blockActions: (kind) => actionsByKind.get(kind) ?? [],
		blockOf: deps.blockOf,
		get commands() {
			return commands;
		},
		get inserts() {
			return inserts;
		},
		get menus() {
			return menus;
		},
		get selectionActions() {
			return selectionActions;
		},
		get paints() {
			return paints;
		},
		get rewrites() {
			return rewrites;
		},
		clipboardBlocks: deps.clipboardBlocks,
		answer,
		get highlighters() {
			return highlighters;
		},
		run,
		can,
		runAtKey: (entry, block) => run(entry, keyed(entry, block)),
		canAtKey: (entry, block) => can(entry, keyed(entry, block)),
		read
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Each block type a plugin lists, with the kind an editor names it and what its maker built. */
function blockTypesOf(unit: InstalledPlugin) {
	return (unit.contribution.blocks ?? []).flatMap((type) => {
		const making = makingOf(type);
		return making ? [{ kind: qualifiedName(unit.name, making.local), making }] : [];
	});
}

/** The commands a plugin's block types place, each with the kinds placing it. */
function placementsOf(unit: InstalledPlugin): Map<Command<unknown>, Set<string>> {
	const placed = new Map<Command<unknown>, Set<string>>();
	for (const { kind, making } of blockTypesOf(unit)) {
		const values = [
			...Object.values(making.chords ?? {}),
			...(making.actions ?? []).map((action) => action.command)
		] as Command<unknown>[];
		for (const value of values) {
			if (!placed.has(value)) placed.set(value, new Set());
			placed.get(value)!.add(kind);
		}
	}
	return placed;
}

/** A plugin's commands: those it lists, those only its block types place, then its marks' toggles,
 *  whose chords bind, rebind and are claimed as a listed command's are. */
function commandsOf(unit: InstalledPlugin): Command<unknown>[] {
	const listed = unit.contribution.commands ?? [];
	const toggles = togglesOf(unit.contribution.inlines);
	return [...new Set([...listed, ...placementsOf(unit).keys()]), ...toggles];
}

/** Why a plugin's commands can't run, qualifying each one's id on the way; null when they can. */
function commandProblem(unit: InstalledPlugin): string | null {
	const ids = new Set<string>();
	const placed = placementsOf(unit);
	for (const value of commandsOf(unit)) {
		const problem = claimCommand(value, unit.name);
		if (problem) return problem;
		if (ids.has(value.id)) return `lists two commands with the id "${value.id}"`;
		ids.add(value.id);
		// A key in the type runs it on its block; a chord of its own would run it in every block.
		if (placed.has(value) && commandSpec(value)?.chord)
			return `has a block type's command "${value.id}" with a chord of its own`;
	}
	return null;
}

/** A plugin's insert rows: its block types' first, each under the type's own name. */
function rowsOf(unit: InstalledPlugin): InsertRow[] {
	const blockRows = blockTypesOf(unit).flatMap(({ making }) =>
		'none' in making.insert ? [] : [{ ...making.insert, id: making.local }]
	);
	return [...blockRows, ...(unit.contribution.inserts ?? [])];
}

function insertProblem(unit: InstalledPlugin): string | null {
	const ids = new Set<string>();
	for (const row of rowsOf(unit)) {
		const problem = insertRowProblem(row);
		if (problem) return problem;
		if (ids.has(row.id)) return `lists two insert rows with the id "${row.id}"`;
		ids.add(row.id);
	}
	return null;
}

function menuProblem(unit: InstalledPlugin): string | null {
	const bad = (unit.contribution.menus ?? []).find(
		(menu) => menu.trigger === '' || /[\r\n]/.test(menu.trigger)
	);
	return bad ? `has a caret menu whose trigger isn't one line of text: "${bad.trigger}"` : null;
}

function actionProblem(unit: InstalledPlugin): string | null {
	for (const action of unit.contribution.selectionActions ?? []) {
		const problem = iconProblem(action.icon);
		if (problem) return `has a selection action that ${problem}`;
	}
	for (const { making } of blockTypesOf(unit)) {
		const problem = iconProblem(making.icon);
		if (problem) return `has a block type that ${problem}`;
		for (const action of making.actions ?? []) {
			const problem = iconProblem(action.icon);
			if (problem) return `has a block action that ${problem}`;
		}
	}
	return null;
}

function entryOf(
	plugin: string,
	value: Command<unknown>,
	placedBy: ReadonlySet<string> = new Set()
): ContributedCommand {
	const spec = commandSpec(value)!;
	const chord = spec.chord ? normalizeChord(spec.chord) : null;
	return { plugin, id: value.id, chord, spec, placedBy };
}

function chordsOf(unit: InstalledPlugin): string[] {
	return commandsOf(unit).flatMap((value) => commandSpec(value)?.chord ?? []);
}

function guardedHighlighter(
	plugin: string,
	code: CodeHighlighter,
	report: (error: PluginError) => void
): ContributedHighlighter {
	// Blocks waiting on one failed load share its reason, so the failure is reported once.
	const heard = new WeakSet<object>();
	const fail = (cause: unknown) => {
		if (typeof cause === 'object' && cause !== null) {
			if (heard.has(cause)) return;
			heard.add(cause);
		}
		report({ plugin, doing: 'highlight', cause });
	};
	return {
		plugin,
		languages() {
			try {
				return code.languages();
			} catch (cause) {
				fail(cause);
				return [];
			}
		},
		highlight(body, language) {
			try {
				const answer = code.highlight(body, language);
				if (!isThenable(answer)) return answer;
				return Promise.resolve(answer).catch((cause: unknown) => (fail(cause), null));
			} catch (cause) {
				fail(cause);
				return null;
			}
		}
	};
}

/** The keys a plugin's container types take, or its leaf types'. */
function blockKeysOf(unit: InstalledPlugin, containers: boolean): string[] {
	return blockTypesOf(unit)
		.filter(({ making }) => (making.registration.container !== undefined) === containers)
		.flatMap(({ making }) => Object.keys(making.chords ?? {}));
}

function rewriteProblem(unit: InstalledPlugin): string | null {
	const bad = (unit.contribution.rewrites ?? []).some(
		(r) => typeof r?.from?.name !== 'string' || typeof r.into !== 'function'
	);
	return bad ? 'has a paste rewrite with no block type in `from` or no `into`' : null;
}

function installError(plugin: string, problem: string): PluginError {
	return { plugin, doing: 'install', cause: new Error(`plugin '${plugin}' ${problem}`) };
}

const kindOfBlock = (value: unknown): string | undefined =>
	typeof value === 'object' && value !== null ? nodeOfBlock(value as Block)?.kind : undefined;

export function isThenable(value: unknown): value is PromiseLike<unknown> {
	return typeof (value as PromiseLike<unknown> | null)?.then === 'function';
}
