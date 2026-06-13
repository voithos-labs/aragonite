/**
 * The command vocabulary, the global command registry, and the key dispatch.
 * A command is a named document intent. GLOBAL commands (undo/redo) are free
 * functions over a minimal context; BLOCK-LOCAL commands are implemented by the
 * focused block component's runCommand. Per-kind keybindings live on
 * BlockKindDescriptor.keymap; this file also holds the editor-global table.
 *
 * Layering: this file is a schema leaf — it must not import action-contracts
 * (which pulls in tree-operations/undo). GlobalCommandContext is the minimal
 * shape global commands need; HistoryActions satisfies it structurally.
 */
import type { AnyBlockKind } from '../core/nodes';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { normalizeChord, type KeyBinding } from './keybindings';

export type GlobalCommandId = 'history.undo' | 'history.redo';
export type BlockCommandId =
	| 'block.split'
	| 'block.hardBreak'
	| 'block.insertTab'
	| 'block.mergePrev'
	| 'block.mergeNext'
	| 'format.toggleStrong'
	| 'format.toggleEmphasis'
	| 'heading.cycle'
	| 'code.newline'
	| 'code.indent'
	| 'code.dedent'
	| 'list.indent'
	| 'list.unindent'
	| 'cell.enter'
	| 'cell.tab'
	| 'cell.shiftTab';
export type CommandId = GlobalCommandId | BlockCommandId;

/** Minimal context a global command needs; HistoryActions is structurally compatible. */
export interface GlobalCommandContext {
	history: { requestUndo(): void | Promise<void>; requestRedo(): void | Promise<void> };
}

export interface CommandDispatchTarget {
	kind: AnyBlockKind;
	runCommand(id: CommandId, arg?: number): boolean;
}

type GlobalCommandRun = (ctx: GlobalCommandContext) => boolean;
const globalCommands = new Map<CommandId, GlobalCommandRun>();

export function registerCommand(id: GlobalCommandId, run: GlobalCommandRun): void {
	globalCommands.set(id, run);
}

export function getCommand(id: CommandId): GlobalCommandRun | undefined {
	return globalCommands.get(id);
}

registerCommand('history.undo', (ctx) => {
	ctx.history.requestUndo();
	return true;
});
registerCommand('history.redo', (ctx) => {
	ctx.history.requestRedo();
	return true;
});

export const GLOBAL_KEYMAP: KeyBinding[] = [
	{ chord: 'Mod+Z', command: 'history.undo' },
	{ chord: 'Mod+Y', command: 'history.redo' },
	{ chord: 'Mod+Shift+Z', command: 'history.redo' }
];

/** Per-kind keymap first, then the editor-global table. Returns the matched binding. */
export function resolveBinding(chord: string, kind: AnyBlockKind): KeyBinding | null {
	const keymap = tryGetBlockKindDescriptor(kind)?.keymap;
	const fromKind = keymap?.find((b) => normalizeChord(b.chord) === chord);
	if (fromKind) return fromKind;
	return GLOBAL_KEYMAP.find((b) => normalizeChord(b.chord) === chord) ?? null;
}

/** Resolve the chord and run the command. Returns true when handled. */
export function dispatchKeyCommand(
	chord: string,
	target: CommandDispatchTarget,
	ctx: GlobalCommandContext
): boolean {
	const binding = resolveBinding(chord, target.kind);
	if (!binding) return false;
	const globalRun = getCommand(binding.command);
	if (globalRun) return globalRun(ctx);
	return target.runCommand(binding.command, binding.arg);
}
