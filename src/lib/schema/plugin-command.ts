/**
 * A plugin's command: `command({ id, title, chord, when, run })` makes one, the plugin lists it in
 * what it contributes, and an editor runs it by value, by `plugin/id` or by its chord. The editor
 * qualifies the id with the plugin's name when it installs the plugin.
 */
import type { Editor } from './plugin-unit';
import { isValidPluginName } from './plugin-name';

// ── Public API ───────────────────────────────────────────────────────────────

/** A key chord: modifiers, then a key; `Mod` is Ctrl, or Cmd on a Mac. */
export type Chord =
	`${'Mod' | 'Alt' | 'Shift' | 'Mod+Alt' | 'Mod+Shift' | 'Alt+Shift' | 'Mod+Alt+Shift'}+${string}`;

interface CommandSpecBase<A> {
	/** Letters, digits and hyphens; the editor runs it as `plugin/id`. */
	id: string;
	title: string;
	/** Whether it can run with this argument now; false greys a button and refuses `run`. */
	when?(editor: Editor, arg: A): boolean;
	/** Returning `false` declines, so a chord goes on to the browser; a throw or a rejection is
	 *  reported under the plugin's name. */
	run(editor: Editor, arg: A): boolean | void | Promise<unknown>;
}

/** What `command` takes. Only a command that runs without an argument binds a chord, since a key
 *  supplies none. */
export type CommandSpec<A = void> = CommandSpecBase<A> &
	([undefined] extends [A] ? { chord?: Chord } : { chord?: never });

/** A command as an editor holds it: run it with `editor.run(command, arg)`. */
export interface Command<A = void> {
	/** `plugin/id` once an editor installs its plugin, the id as written before that. */
	readonly id: string;
	readonly title: string;
	/** Carries the argument type; never set. */
	readonly '~arg'?: A;
}

/** Makes a command for a plugin to list in what it contributes. */
export function command<A = void>(spec: CommandSpec<A>): Command<A> {
	const slot: CommandSlot = { spec: spec as CommandSpec<unknown>, plugin: null };
	return Object.freeze({
		get id() {
			return slot.plugin === null ? spec.id : `${slot.plugin}/${spec.id}`;
		},
		title: spec.title,
		[SLOT]: slot
	});
}

// ── Install ──────────────────────────────────────────────────────────────────

/** The spec behind a command value, or null for anything `command` didn't make. */
export function commandSpec(value: unknown): CommandSpec<unknown> | null {
	return slotOf(value)?.spec ?? null;
}

/** Gives a command its plugin, which qualifies its id; a sentence when it can't belong to `plugin`. */
export function claimCommand(value: Command<unknown>, plugin: string): string | null {
	const slot = slotOf(value);
	if (!slot) return `lists a command \`command()\` didn't make`;
	if (!isValidPluginName(slot.spec.id)) {
		return `has a command id "${slot.spec.id}"; lowercase first letter, then letters/digits/hyphens`;
	}
	if (slot.plugin !== null && slot.plugin !== plugin) {
		return `lists the command "${slot.spec.id}", which plugin '${slot.plugin}' already lists`;
	}
	slot.plugin = plugin;
	return null;
}

// ── Internal ─────────────────────────────────────────────────────────────────

// Shared across copies of the core, so a command another copy made still reads.
const SLOT = Symbol.for('@voithos-labs/aragonite:command');

interface CommandSlot {
	spec: CommandSpec<unknown>;
	plugin: string | null;
}

function slotOf(value: unknown): CommandSlot | undefined {
	return typeof value === 'object' && value !== null
		? (value as { [SLOT]?: CommandSlot })[SLOT]
		: undefined;
}
