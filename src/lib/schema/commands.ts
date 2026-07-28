/**
 * The command vocabulary, the global command registry, and chord→binding
 * resolution. A command is a named document intent. GLOBAL commands (undo/redo)
 * are free functions over a minimal context; BLOCK-LOCAL commands are implemented
 * by the focused block component's runCommand or a registered block-command
 * handler. Per-kind keybindings live on BlockKindDescriptor.keymap; this file
 * also holds the editor-global table. The chord dispatchers themselves live in
 * `./block-commands` (both the leaf and container-bubble paths), which reads this
 * file's resolvers and the block-command registry through one seam — kept there,
 * not here, so this file carries no runtime edge to block-commands.
 *
 * Layering: this file is a schema leaf — it must not import action-contracts
 * (which pulls in tree-operations/undo). GlobalCommandContext is the minimal
 * shape global commands need; HistoryActions satisfies it structurally.
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
// Type-only: no runtime edge. GlobalCommandContext carries a per-instance
// EditorContext lookup and the dispatch seam's error sink; both are structural
// references, so this schema leaf keeps no value edge to plugin-install or
// block-commands.
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

/**
 * True when the id is part of the closed built-in vocabulary (not a minted
 * plugin id). Accepts a plain name so probes needn't pre-brand (the
 * `isBlockKindRegistered` convention).
 */
export function isBuiltinCommandId(id: string): boolean {
	return BUILTIN_COMMAND_IDS.has(id);
}

/**
 * Test-only. Removes every command outside the closed built-in vocabulary —
 * minted block AND global command handlers alike, since both key into
 * `globalCommands`/the block registry. The plugin-global chord keymap resets
 * separately (`__resetPluginGlobalKeymapForTests`).
 */
export function __removePluginCommandsForTests(): void {
	for (const id of globalCommands.keys()) {
		if (!BUILTIN_COMMAND_IDS.has(id)) globalCommands.delete(id);
	}
}

const warnedUnresolvedIds = new Set<string>();

/**
 * Dev-warn once per id that a bound command reached no runnable handler on the
 * dispatch path that fired — a dead key. Shared by both paths (leaf and
 * container-bubble). "Reachable", not "registered": both paths resolve a minted
 * command only when the dispatch target supplies a command context, so a command
 * bound where no context is available (a built-in leaf, the cross-block replay
 * target) signals unreachability, not necessarily a missing registration. Silent
 * in production (devWarn).
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
// A plugin's global command may claim a chord here. It resolves LAST — after
// every override, built-in kind, and built-in global tier — and built-in chords
// are unstealable (register-once, throw-on-collision).

const pluginGlobalKeymap: KeyBinding[] = [];

// Chords the editor UI intercepts outside the command resolvers (the search bar's
// document-level listener) — a plugin binding one would double-fire: its command
// at the leaf AND the UI action, on one keypress.
const RESERVED_UI_CHORDS = new Set(['Mod+F', 'Mod+H']);

/**
 * True when a chord is intercepted by the editor UI outside the command resolvers
 * (the search bar's document-level Ctrl+F / Ctrl+H). The single source both the
 * plugin-global registration guard and the editor-root keydown handler read, so
 * the reserved set is never hardcoded twice.
 */
export function isReservedUiChord(chord: string): boolean {
	return RESERVED_UI_CHORDS.has(normalizeChord(chord));
}

/**
 * `candidateCommand` is the id the incoming registration will bind — a plain name
 * (the mint is deterministic: name IS the id). On a dev-server re-eval a registrar
 * re-binds its OWN same command to its OWN same chord; that is an idempotent replace,
 * not a collision. Reserved chords and cross-command collisions still throw — the
 * same-key valve cannot distinguish those genuine conflicts.
 */
export function assertPluginGlobalChordAvailable(
	rawChord: string,
	candidateCommand?: string
): void {
	// A public registration API fails loudly, not warn-and-drop: a malformed chord
	// (the `'Ctrl+B'` → bare `'B'` trap) that slipped through would bind a handler
	// that fires on every plain keypress. Thrown before the mint (see
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
	// A dev re-eval passed the same-command exemption above; replace the prior
	// binding in place instead of stacking a duplicate. Fresh registrations never
	// find an existing entry (the assert would have thrown).
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
 * The consumer-override tier shared by both leaf and bubble resolution: kind
 * override, then global override. Returns the decision (a binding, or `null` for a
 * disable) when either tier decides, `undefined` when neither does — so the caller
 * falls through to its own built-in tiers.
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
 * Container-bubble resolution: override(kind) → override(global) → built-in kind
 * keymap. No built-in GLOBAL fallthrough — undo/redo belong to the focused leaf,
 * and a bubble re-firing the built-in global table would double-fire (see
 * `dispatchKindCommand` in `./block-commands`). Consumer overrides ARE honored at
 * both scopes: a `keybindings` decision is a per-instance intent that must mean
 * the same at the leaf and the bubble. So a global DISABLE unbinds a chord even
 * where a kind defines it (the container-bubble hole this closes), and a global
 * BIND shadows the built-in kind binding too — routing to the container's
 * `runCommand`, which declines an unowned command, rather than falling through to
 * the shadowed built-in and firing a second, unasked action.
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
	const override = overrideTier(overrides, kind, chord);
	if (override !== undefined) return override;
	return builtinKindBinding(chord, kind) ?? builtinGlobalBinding(chord);
}

/**
 * True when the editor-global keymap binds this chord (today: undo/redo). The
 * input-layer interception sites consult this to know which chords they own —
 * then route the command through the override-aware resolver. Precise: it never
 * matches a modified variant like `Mod+Alt+Y`, only the exact global chords.
 * Includes plugin-global chords so an input-layer site that owns the global tier
 * (editor-root, thematic break) intercepts a plugin chord too.
 */
export function isEditorGlobalChord(chord: string): boolean {
	return builtinGlobalBinding(chord) !== null;
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
	return builtinGlobalBinding(chord);
}
