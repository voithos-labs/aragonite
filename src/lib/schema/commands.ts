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
import type { AnyCommandId } from './command-id';
import { devWarn } from '../dev-warn';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { normalizeChord, type KeyBinding } from './keybindings';
import {
	lookupOverride,
	overrideDecision,
	type KeybindingOverrideMap
} from './keybinding-overrides';

export const GLOBAL_COMMAND_IDS = ['history.undo', 'history.redo'] as const;
export const BLOCK_COMMAND_IDS = [
	'block.split',
	'block.hardBreak',
	'block.insertTab',
	'block.mergePrev',
	'block.mergeNext',
	'block.moveUp',
	'block.moveDown',
	'format.toggleStrong',
	'format.toggleEmphasis',
	'heading.cycle',
	'code.newline',
	'code.indent',
	'code.dedent',
	'code.backspace',
	'code.delete',
	'list.indent',
	'list.unindent',
	'cell.enter',
	'cell.tab',
	'cell.shiftTab',
	'chrome.descendToBody'
] as const;
export type GlobalCommandId = (typeof GLOBAL_COMMAND_IDS)[number];
export type BlockCommandId = (typeof BLOCK_COMMAND_IDS)[number];
export type CommandId = GlobalCommandId | BlockCommandId;

/** Minimal context a global command needs; HistoryActions is structurally compatible. */
export interface GlobalCommandContext {
	history: { requestUndo(): void | Promise<void>; requestRedo(): void | Promise<void> };
}

export interface CommandDispatchTarget {
	kind: AnyBlockKind;
	runCommand(id: AnyCommandId, arg?: unknown): boolean;
}

type GlobalCommandRun = (ctx: GlobalCommandContext) => boolean;
const globalCommands = new Map<AnyCommandId, GlobalCommandRun>();

export function registerCommand(id: GlobalCommandId, run: GlobalCommandRun): void {
	if (globalCommands.has(id)) {
		throw new Error(`registerCommand: "${id}" is already registered. Commands are register-once.`);
	}
	globalCommands.set(id, run);
}

export function getCommand(id: AnyCommandId): GlobalCommandRun | undefined {
	return globalCommands.get(id);
}

const BUILTIN_COMMAND_IDS = new Set<string>([...GLOBAL_COMMAND_IDS, ...BLOCK_COMMAND_IDS]);

/** True when the id is part of the closed built-in vocabulary (not a minted plugin id). */
export function isBuiltinCommandId(id: AnyCommandId): boolean {
	return BUILTIN_COMMAND_IDS.has(id);
}

/** Test-only. Removes every command outside the closed built-in vocabulary. */
export function __removePluginCommandsForTests(): void {
	for (const id of globalCommands.keys()) {
		if (!BUILTIN_COMMAND_IDS.has(id)) globalCommands.delete(id);
	}
}

const warnedUnresolvedIds = new Set<string>();

/**
 * Dev-warn once per id that a bound command reached no runnable handler on the
 * dispatch path that fired — a dead key. Shared by both paths (leaf and
 * container-bubble). "Reachable", not "registered": a handler may be registered on
 * a kind whose dispatch tier isn't wired here — a plugin command bound on a leaf
 * kind, where the leaf registry tier is deferred — so this signals unreachability,
 * not necessarily a missing registration. Silent in production (devWarn).
 */
export function warnUnresolvedPluginCommand(id: AnyCommandId): void {
	if (warnedUnresolvedIds.has(id)) return;
	warnedUnresolvedIds.add(id);
	devWarn('commands', `command "${id}" reached no handler on this dispatch path; key is dead`);
}

/** Test-only. Clears the once-per-id warn set so each test sees a first-time warn. */
export function __resetCommandWarningsForTests(): void {
	warnedUnresolvedIds.clear();
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

function builtinKindBinding(chord: string, kind: AnyBlockKind): KeyBinding | null {
	const keymap = tryGetBlockKindDescriptor(kind)?.keymap;
	return keymap?.find((b) => normalizeChord(b.chord) === chord) ?? null;
}

/**
 * Per-kind keymap ONLY — no global fallthrough. Override(kind) decides first
 * (binding shadows, 'disabled' short-circuits without consulting the built-in);
 * absent → built-in kind keymap. Container bubble handlers use this: the global
 * tier belongs to the focused leaf (see existing double-fire note).
 */
export function resolveKindBinding(
	chord: string,
	kind: AnyBlockKind,
	overrides?: KeybindingOverrideMap
): KeyBinding | null {
	const decision = overrideDecision(lookupOverride(overrides, kind, chord));
	if (decision !== undefined) return decision;
	return builtinKindBinding(chord, kind);
}

/**
 * Leaf precedence: override(kind) → override(global) → built-in kind → built-in
 * global. An override (bind or disable) at any tier ends resolution. Override
 * source dominates specificity (override-global before built-in-kind) so a
 * global disable suppresses a chord even where a kind defines it.
 */
export function resolveBinding(
	chord: string,
	kind: AnyBlockKind,
	overrides?: KeybindingOverrideMap
): KeyBinding | null {
	const kindDecision = overrideDecision(lookupOverride(overrides, kind, chord));
	if (kindDecision !== undefined) return kindDecision;
	const globalDecision = overrideDecision(lookupOverride(overrides, 'global', chord));
	if (globalDecision !== undefined) return globalDecision;
	return (
		builtinKindBinding(chord, kind) ??
		GLOBAL_KEYMAP.find((b) => normalizeChord(b.chord) === chord) ??
		null
	);
}

/**
 * True when the editor-global keymap binds this chord (today: undo/redo). The
 * input-layer interception sites consult this to know which chords they own —
 * then route the command through the override-aware resolver. Precise: it never
 * matches a modified variant like `Mod+Alt+Y`, only the exact global chords.
 */
export function isEditorGlobalChord(chord: string): boolean {
	return GLOBAL_KEYMAP.some((b) => normalizeChord(b.chord) === chord);
}

/**
 * Resolve a chord at GLOBAL scope only: a consumer global override (bind or
 * disable), else the editor-global keymap. For input-layer sites that own
 * undo/redo with no focused block (the editor-root keydown listener), where a
 * kind tier would have no block to apply to.
 */
export function resolveGlobalBinding(
	chord: string,
	overrides?: KeybindingOverrideMap
): KeyBinding | null {
	const decision = overrideDecision(lookupOverride(overrides, 'global', chord));
	if (decision !== undefined) return decision;
	return GLOBAL_KEYMAP.find((b) => normalizeChord(b.chord) === chord) ?? null;
}

/** Resolve the chord and run the command. Returns true when handled. */
export function dispatchKeyCommand(
	chord: string,
	target: CommandDispatchTarget,
	ctx: GlobalCommandContext,
	overrides?: KeybindingOverrideMap
): boolean {
	const binding = resolveBinding(chord, target.kind, overrides);
	if (!binding) return false;
	const globalRun = getCommand(binding.command);
	if (globalRun) return globalRun(ctx);
	// A non-built-in id on the leaf path is a plugin id with no leaf handler (the
	// leaf registry tier is deferred — plugin commands dispatch on the bubble path):
	// dead-key rather than hand it to a leaf runCommand that can't resolve it.
	if (!isBuiltinCommandId(binding.command)) {
		warnUnresolvedPluginCommand(binding.command);
		return false;
	}
	return target.runCommand(binding.command, binding.arg);
}
