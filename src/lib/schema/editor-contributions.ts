/**
 * What the plugin values one editor runs contribute: their commands, by value, by `plugin/id` and
 * by chord, their insert rows and their caret menus. Read from each installed list, so `use`
 * rebuilds it, and reached through the editor's activation, which every command lookup already
 * takes, so no route that runs or lists a command can miss a plugin's.
 */
import type { Editor, InstalledPlugin, PluginError } from './plugin-unit';
import { claimCommand, commandSpec, type Command, type CommandSpec } from './plugin-command';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { isMotionChord, normalizeChord } from './keybindings';
import { refusedClaims } from './plugin-claims';
import { insertRowProblem, type InsertRow } from './insert-catalogue';
import type { ContributedMenu } from './caret-menu';
import { iconProblem, type ContributedAction } from './selection-action';

export interface ContributedCommand {
	readonly plugin: string;
	/** `plugin/id`. */
	readonly id: string;
	/** The chord as the keymap spells it, or null. */
	readonly chord: string | null;
	readonly spec: CommandSpec<unknown>;
}

export interface EditorContributions {
	command(command: Command<unknown> | string): ContributedCommand | undefined;
	atChord(chord: string): ContributedCommand | undefined;
	readonly commands: readonly ContributedCommand[];
	/** Each plugin's rows in list order, ids as `plugin/id`. */
	readonly inserts: readonly InsertRow[];
	/** Each plugin's caret menus, in list order. */
	readonly menus: readonly ContributedMenu[];
	/** Each plugin's selection actions, in list order. */
	readonly actions: readonly ContributedAction[];
	/** Runs a command against its plugin's scoped editor; false where `when` or the command declines.
	 *  A throw counts as run, so the key goes no further, and is reported. */
	run(command: ContributedCommand, arg: unknown): boolean;
	can(command: ContributedCommand, arg: unknown): boolean;
	/** Reads a freshly installed list, leaving out and reporting each plugin whose contribution is
	 *  unusable or claims what one listed before it holds; returns the plugins kept. */
	read(units: readonly InstalledPlugin[]): InstalledPlugin[];
}

export function createEditorContributions(deps: {
	editorFor(plugin: string): Editor | undefined;
	report(error: PluginError): void;
}): EditorContributions {
	let commands: ContributedCommand[] = [];
	let byValue = new Map<Command<unknown>, ContributedCommand>();
	let byId = new Map<string, ContributedCommand>();
	let byChord = new Map<string, ContributedCommand>();
	let inserts: readonly InsertRow[] = [];
	let menus: readonly ContributedMenu[] = [];
	let actions: readonly ContributedAction[] = [];

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
				commandProblem(unit) ?? insertProblem(unit) ?? menuProblem(unit) ?? actionProblem(unit);
			if (problem) deps.report(installError(unit.name, problem));
			return !problem;
		});
		const refused = refusedClaims(
			usable.map((unit) => ({ plugin: unit.name, claims: { chords: chordsOf(unit) } })),
			deps.report
		);
		const kept = usable.filter((unit) => !refused.has(unit.name));
		const listed = kept.flatMap((unit) =>
			(unit.contribution.commands ?? []).map((value) => [value, entryOf(unit.name, value)] as const)
		);
		commands = listed.map(([, entry]) => entry);
		byValue = new Map(listed);
		byId = new Map(commands.map((entry) => [entry.id, entry]));
		byChord = new Map(commands.flatMap((entry) => (entry.chord ? [[entry.chord, entry]] : [])));
		for (const { chord, plugin } of commands) {
			if (chord && isMotionChord(chord))
				devWarn(
					'keybindings',
					`plugin '${plugin}' binds "${chord}", which moves the caret on this platform, so it never fires`
				);
		}
		inserts = kept.flatMap((unit) =>
			(unit.contribution.inserts ?? []).map((row) =>
				Object.freeze({ ...row, id: `${unit.name}/${row.id}` })
			)
		);
		menus = kept.flatMap((unit) =>
			(unit.contribution.menus ?? []).map((menu) => ({ plugin: unit.name, menu }))
		);
		actions = kept.flatMap((unit) =>
			(unit.contribution.actions ?? []).map((action) => ({ plugin: unit.name, action }))
		);
		return kept;
	}

	function can(entry: ContributedCommand, arg: unknown): boolean {
		const editor = deps.editorFor(entry.plugin);
		const { when } = entry.spec;
		return !!editor && (!when || guarded(entry, false, () => when(editor, arg)));
	}

	function run(entry: ContributedCommand, arg: unknown): boolean {
		const editor = deps.editorFor(entry.plugin);
		if (!editor || !can(entry, arg)) return false;
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

	return {
		command: (command) => (typeof command === 'string' ? byId.get(command) : byValue.get(command)),
		atChord: (chord) => byChord.get(chord),
		get commands() {
			return commands;
		},
		get inserts() {
			return inserts;
		},
		get menus() {
			return menus;
		},
		get actions() {
			return actions;
		},
		run,
		can,
		read
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Why a plugin's commands can't run, qualifying each one's id on the way; null when they can. */
function commandProblem(unit: InstalledPlugin): string | null {
	const ids = new Set<string>();
	for (const value of unit.contribution.commands ?? []) {
		const problem = claimCommand(value, unit.name);
		if (problem) return problem;
		if (ids.has(value.id)) return `lists two commands with the id "${value.id}"`;
		ids.add(value.id);
	}
	return null;
}

function insertProblem(unit: InstalledPlugin): string | null {
	const ids = new Set<string>();
	for (const row of unit.contribution.inserts ?? []) {
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
	for (const action of unit.contribution.actions ?? []) {
		const problem = iconProblem(action.icon);
		if (problem) return `has a selection action that ${problem}`;
	}
	return null;
}

function entryOf(plugin: string, value: Command<unknown>): ContributedCommand {
	const spec = commandSpec(value)!;
	return { plugin, id: value.id, chord: spec.chord ? normalizeChord(spec.chord) : null, spec };
}

function chordsOf(unit: InstalledPlugin): string[] {
	return (unit.contribution.commands ?? []).flatMap((value) => commandSpec(value)?.chord ?? []);
}

function installError(plugin: string, problem: string): PluginError {
	return { plugin, doing: 'install', cause: new Error(`plugin '${plugin}' ${problem}`) };
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
	return typeof (value as PromiseLike<unknown> | null)?.then === 'function';
}
