/**
 * The command vocabulary, the global command registry, and chord→binding resolution. GLOBAL
 * commands (undo/redo) are free functions over a minimal context; BLOCK-LOCAL ones run on the
 * focused block or a registered block-command handler. The chord dispatchers live in
 * `./block-commands`, not here, so this file carries no runtime edge to it. Schema leaf: it may
 * not import action-contracts, so `GlobalCommandContext` is what `HistoryActions` satisfies.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { AnyCommandId } from './command-id';
import { devWarn } from '../dev-warn';
import { registerOnce, devReplacesRegistration } from './register-once';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { normalizeChord, isChordWellFormed, type KeyBinding } from './keybindings';
import {
	lookupOverride,
	overrideDecision,
	type KeybindingOverrideMap
} from './keybinding-overrides';
// Type-only: structural references, so this schema leaf keeps no value edge to plugin-install
// or block-commands.
import type { EditorContext } from './plugin-install';
import type { CommandErrorSink } from './block-commands';
import type { PresentationMode } from '../presentation-mode';

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
	// Bound on `tableCell` (the focused surface) but named for their subject: each takes the
	// focused cell's row or column as its index, supplied from the cell's own props.
	'table.insertRowBelow',
	'table.insertRowAbove',
	'table.insertColumnRight',
	'table.insertColumnLeft',
	'table.deleteRow',
	'table.deleteColumn',
	'table.moveRowUp',
	'table.moveRowDown',
	'table.moveColumnLeft',
	'table.moveColumnRight',
	'table.cycleAlignment',
	'chrome.descendToBody'
] as const;
export type GlobalCommandId = (typeof GLOBAL_COMMAND_IDS)[number];
export type BlockCommandId = (typeof BLOCK_COMMAND_IDS)[number];
export type CommandId = GlobalCommandId | BlockCommandId;

/** Minimal context a global command needs; HistoryActions is structurally compatible. */
export interface GlobalCommandContext {
	history: { requestUndo(): void | Promise<void>; requestRedo(): void | Promise<void> };
	/** Per-instance context lookup, threaded from the dispatching editor. */
	pluginEditor?: (pluginName: string) => EditorContext;
	/** The effective presentation mode, read live — the reading-mode gate keys off this,
	 *  not the plugin lookup. Absent (a history-only context) means source. */
	getPresentationMode?: () => PresentationMode;
	/** Injected by dispatchKeyCommand — routes a contained handler throw. */
	onCommandError?: CommandErrorSink;
}

type GlobalCommandRun = (ctx: GlobalCommandContext) => boolean;
const globalCommands = new Map<AnyCommandId, GlobalCommandRun>();

export function registerCommand(id: AnyCommandId, run: GlobalCommandRun): void {
	registerOnce(
		globalCommands.has(id),
		() => globalCommands.set(id, run),
		`registerCommand: "${id}" is already registered. Commands are register-once.`
	);
}

export function getCommand(id: AnyCommandId): GlobalCommandRun | undefined {
	return globalCommands.get(id);
}

const BUILTIN_COMMAND_IDS = new Set<string>([...GLOBAL_COMMAND_IDS, ...BLOCK_COMMAND_IDS]);

/** True when the id is in the closed built-in vocabulary. Takes a plain, unbranded name. */
export function isBuiltinCommandId(id: string): boolean {
	return BUILTIN_COMMAND_IDS.has(id);
}

/**
 * Test-only. Removes every command outside the closed built-in vocabulary; the plugin-global
 * chord keymap resets separately (`__resetPluginGlobalKeymapForTests`).
 */
export function __removePluginCommandsForTests(): void {
	for (const id of globalCommands.keys()) {
		if (!BUILTIN_COMMAND_IDS.has(id)) globalCommands.delete(id);
	}
}

const warnedUnresolvedIds = new Set<string>();

/**
 * Dev-warn once per id that a bound command reached no runnable handler on the dispatch path
 * that fired — a dead key. Unreachable, not unregistered: a minted command resolves only where
 * the dispatch target supplies a command context.
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
	void ctx.history.requestUndo();
	return true;
});
registerCommand('history.redo', (ctx) => {
	void ctx.history.requestRedo();
	return true;
});

export const GLOBAL_KEYMAP: KeyBinding[] = [
	{ chord: 'Mod+Z', command: 'history.undo' },
	{ chord: 'Mod+Y', command: 'history.redo' },
	{ chord: 'Mod+Shift+Z', command: 'history.redo' }
];

// ── Plugin-global chord tier ─────────────────────────────────────────────
// A plugin's global command may claim a chord here. It resolves LAST, after every override and
// built-in tier, and built-in chords are unstealable (register-once, throw-on-collision).

const pluginGlobalKeymap: KeyBinding[] = [];

// Chords the editor UI intercepts outside the command resolvers (the search bar's
// document-level listener) — a plugin binding one would double-fire on a single keypress.
const RESERVED_UI_CHORDS = new Set(['Mod+F', 'Mod+H']);

/**
 * True when the editor UI intercepts a chord outside the command resolvers. The single source
 * both the plugin-global registration guard and the editor-root keydown handler read.
 */
export function isReservedUiChord(chord: string): boolean {
	return RESERVED_UI_CHORDS.has(normalizeChord(chord));
}

/**
 * `candidateCommand` is the id the incoming registration will bind (the mint is deterministic:
 * name IS the id). A dev-server re-eval re-binding its OWN command to its OWN chord is an
 * idempotent replace, not a collision; reserved chords and cross-command collisions still throw.
 */
export function assertPluginGlobalChordAvailable(
	rawChord: string,
	candidateCommand?: string
): void {
	// Fails loudly, not warn-and-drop: a malformed chord (the `'Ctrl+B'` → bare `'B'` trap) would
	// bind a handler that fires on every plain keypress. Thrown before the mint (see
	// global-commands.ts), so a rejected registration leaves no orphaned command.
	if (!isChordWellFormed(rawChord)) {
		throw new Error(
			`plugin global chord "${rawChord}" is malformed — modifiers must be Mod/Alt/Shift and the key non-empty`
		);
	}
	const chord = normalizeChord(rawChord);
	if (RESERVED_UI_CHORDS.has(chord)) {
		throw new Error(
			`plugin global chord "${rawChord}" is reserved by the editor UI (search) — pick another chord`
		);
	}
	const collision =
		GLOBAL_KEYMAP.find((b) => normalizeChord(b.chord) === chord) ??
		pluginGlobalKeymap.find((b) => normalizeChord(b.chord) === chord);
	if (collision) {
		if (devReplacesRegistration() && collision.command === candidateCommand) return;
		throw new Error(
			`plugin global chord "${rawChord}" is already bound to "${collision.command}" — global chords are register-once`
		);
	}
}

export function registerPluginGlobalBinding(binding: KeyBinding): void {
	assertPluginGlobalChordAvailable(binding.chord, binding.command);
	// A dev re-eval passed the same-command exemption above: replace in place instead of stacking
	// a duplicate. A fresh registration never finds an existing entry.
	const chord = normalizeChord(binding.chord);
	const existing = pluginGlobalKeymap.findIndex((b) => normalizeChord(b.chord) === chord);
	if (existing >= 0) pluginGlobalKeymap[existing] = binding;
	else pluginGlobalKeymap.push(binding);
}

export function pluginGlobalBinding(chord: string): KeyBinding | null {
	return pluginGlobalKeymap.find((b) => normalizeChord(b.chord) === chord) ?? null;
}

export function __resetPluginGlobalKeymapForTests(): void {
	pluginGlobalKeymap.length = 0;
}

function builtinKindBinding(chord: string, kind: AnyBlockKind): KeyBinding | null {
	const keymap = tryGetBlockKindDescriptor(kind)?.keymap;
	return keymap?.find((b) => normalizeChord(b.chord) === chord) ?? null;
}

/**
 * The consumer-override tier shared by leaf and bubble resolution: kind override, then global.
 * `null` is a disable decision; `undefined` means neither tier decided.
 */
function overrideTier(
	overrides: KeybindingOverrideMap | undefined,
	kind: AnyBlockKind,
	chord: string
): KeyBinding | null | undefined {
	const kindDecision = overrideDecision(lookupOverride(overrides, kind, chord));
	if (kindDecision !== undefined) return kindDecision;
	return overrideDecision(lookupOverride(overrides, 'global', chord));
}

/** The built-in global keymap tier, then the plugin-global tier — the shared tail of
 *  leaf resolution and both global-only resolvers. */
function builtinGlobalBinding(chord: string): KeyBinding | null {
	return GLOBAL_KEYMAP.find((b) => normalizeChord(b.chord) === chord) ?? pluginGlobalBinding(chord);
}

/**
 * Container-bubble resolution: override(kind) → override(global) → built-in kind keymap. No
 * built-in GLOBAL fallthrough — undo/redo belong to the focused leaf, and a bubble re-firing
 * them would double-fire. Consumer overrides ARE honored at both scopes, so a global disable
 * unbinds a chord a kind defines, and a global bind shadows the built-in kind binding.
 */
export function resolveKindBinding(
	chord: string,
	kind: AnyBlockKind,
	overrides?: KeybindingOverrideMap
): KeyBinding | null {
	const override = overrideTier(overrides, kind, chord);
	if (override !== undefined) return override;
	return builtinKindBinding(chord, kind);
}

/**
 * Leaf precedence: override(kind) → override(global) → built-in kind → built-in global. Override
 * source dominates specificity, so a global disable suppresses a chord a kind defines.
 */
export function resolveBinding(
	chord: string,
	kind: AnyBlockKind,
	overrides?: KeybindingOverrideMap
): KeyBinding | null {
	const override = overrideTier(overrides, kind, chord);
	if (override !== undefined) return override;
	return builtinKindBinding(chord, kind) ?? builtinGlobalBinding(chord);
}

/**
 * True when the editor-global or plugin-global keymap binds this exact chord — never a modified
 * variant like `Mod+Alt+Y`. Input-layer sites consult it to know which chords they own.
 */
export function isEditorGlobalChord(chord: string): boolean {
	return builtinGlobalBinding(chord) !== null;
}

/**
 * Resolve a chord at GLOBAL scope only, for input-layer sites with no focused block for a kind
 * tier to apply to: a consumer global override, else the editor-global keymap.
 */
export function resolveGlobalBinding(
	chord: string,
	overrides?: KeybindingOverrideMap
): KeyBinding | null {
	const decision = overrideDecision(lookupOverride(overrides, 'global', chord));
	if (decision !== undefined) return decision;
	return builtinGlobalBinding(chord);
}
