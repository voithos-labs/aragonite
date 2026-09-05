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
import { deletePluginEntries, registerOnce, devReplacesRegistration } from './register-once';
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
import type { PluginActivation } from './plugin-activation';
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
	'format.toggleStrikethrough',
	'format.toggleCode',
	'link.openCard',
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

/**
 * Commands whose arms rewrite one block's bytes around that block's own selection and have no
 * cross-block reading: the dispatch seam declines them outright while a range is painted.
 * Membership is the arm's shape, not the id's prefix — the link card mints its link over one
 * block's offsets, and a range gives it no one block to mint into.
 */
export const RANGE_DECLINED_COMMAND_IDS: ReadonlySet<string> = new Set<CommandId>([
	'link.openCard'
]);

/**
 * The same one-block arms, but with a cross-block one behind them
 * (`selection/cross-block/format-toggle.ts`), which the seam routes to through an injected
 * router. Declined wherever no router is threaded, so a dispatch site that skips it cannot
 * fall through to the focused block's own offsets.
 */
export const CROSS_BLOCK_RANGE_COMMAND_IDS: ReadonlySet<string> = new Set<CommandId>([
	'format.toggleStrong',
	'format.toggleEmphasis',
	'format.toggleStrikethrough',
	'format.toggleCode'
]);

/**
 * The command ids a host's selection toolbar invokes through `EditorInstance.runCommand`. The
 * rest of the vocabulary stays internal until the command registry unifies it.
 */
export const TOOLBAR_COMMANDS = {
	toggleStrong: 'format.toggleStrong',
	toggleEmphasis: 'format.toggleEmphasis',
	toggleStrikethrough: 'format.toggleStrikethrough',
	toggleCode: 'format.toggleCode',
	/** The link editor Mod+K opens: over a selection it creates, inside a link it edits. */
	editLink: 'link.openCard'
} as const satisfies Record<string, CommandId>;

/** Minimal context a global command needs; HistoryActions is structurally compatible. */
export interface GlobalCommandContext {
	history: { requestUndo(): void | Promise<void>; requestRedo(): void | Promise<void> };
	/** Per-instance context lookup, threaded from the dispatching editor; it resolves nothing
	 *  for a plugin installed in the process that this editor did not activate. */
	pluginEditor?: (pluginName: string) => EditorContext | undefined;
	/** The plugins the dispatching editor activated, so the process-global plugin-global tier
	 *  claims a chord only where its plugin is live. Absent = every installed plugin. */
	activation?: PluginActivation;
	/** The effective presentation mode, read live — the reading-mode gate keys off this,
	 *  not the plugin lookup. Absent (a history-only context) means source. */
	getPresentationMode?: () => PresentationMode;
	/** Injected by dispatchKeyCommand — routes a contained handler throw. */
	onCommandError?: CommandErrorSink;
}

export type GlobalCommandRun = (ctx: GlobalCommandContext) => boolean;
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
	deletePluginEntries(globalCommands, (id) => BUILTIN_COMMAND_IDS.has(id));
}

/** Which seam found the command dead. Half the memo key below: a no-op at one seam must not
 *  spend the one-time diagnostic another seam still owes. */
export type CommandDispatchPath = 'chord' | 'door' | 'plugin-global' | 'global-chord';

const warnedDeadKeys = new Set<string>();

/**
 * Dev-warn once per (id, path) that a command reached no runnable handler at `path` — a dead
 * key. Unreachable, not unregistered: a minted command resolves only where the dispatch target
 * supplies a command context.
 */
export function warnDeadKeyCommand(id: AnyCommandId, path: CommandDispatchPath): void {
	const key = `${path} ${id}`;
	if (warnedDeadKeys.has(key)) return;
	warnedDeadKeys.add(key);
	devWarn('commands', `command "${id}" reached no handler on the ${path} path; key is dead`);
}

/** Test-only. Clears the dead-key warn memo so each test sees a first-time warn. */
export function __resetCommandWarningsForTests(): void {
	warnedDeadKeys.clear();
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

/** A plugin-global binding plus the plugin that installed it, so an instance's activation
 *  decides whether the chord is claimed here. A null owner is never gated. */
interface PluginGlobalBinding extends KeyBinding {
	plugin: string | null;
}

const pluginGlobalKeymap: PluginGlobalBinding[] = [];

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

/** The same pair, for the callers that must enumerate it rather than test one chord. */
export function reservedUiChords(): readonly string[] {
	return [...RESERVED_UI_CHORDS];
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
	// Activation-blind: registration is process-global register-once, so a chord no editor
	// has activated yet still collides.
	const collision = builtinGlobalBinding(chord, undefined);
	if (collision) {
		if (devReplacesRegistration() && collision.command === candidateCommand) return;
		throw new Error(
			`plugin global chord "${rawChord}" is already bound to "${collision.command}" — global chords are register-once`
		);
	}
}

export function registerPluginGlobalBinding(binding: KeyBinding, plugin: string | null): void {
	assertPluginGlobalChordAvailable(binding.chord, binding.command);
	// A dev re-eval passed the same-command exemption above: replace in place instead of stacking
	// a duplicate. A fresh registration never finds an existing entry.
	const chord = normalizeChord(binding.chord);
	const entry = { ...binding, plugin };
	const existing = pluginGlobalKeymap.findIndex((b) => normalizeChord(b.chord) === chord);
	if (existing >= 0) pluginGlobalKeymap[existing] = entry;
	else pluginGlobalKeymap.push(entry);
}

/** The tier's one activation gate: every read of a plugin-global chord passes through it,
 *  and an absent activation means every installed plugin. */
function claimedHere(
	entry: PluginGlobalBinding,
	activation: PluginActivation | undefined
): boolean {
	return entry.plugin === null || activation === undefined || activation.isActive(entry.plugin);
}

export function pluginGlobalBinding(
	chord: string,
	activation?: PluginActivation
): KeyBinding | null {
	const entry = findByChord(pluginGlobalKeymap, chord);
	return entry && claimedHere(entry, activation) ? entry : null;
}

/** Every chord the plugin-global tier binds for `activation`. Registration is process-global,
 *  so an absent activation reflects plugins any mounted editor installed. */
export function pluginGlobalChords(activation?: PluginActivation): readonly string[] {
	return pluginGlobalKeymap
		.filter((entry) => claimedHere(entry, activation))
		.map((b) => normalizeChord(b.chord));
}

export function __resetPluginGlobalKeymapForTests(): void {
	pluginGlobalKeymap.length = 0;
}

/** First binding in `bindings` whose chord normalizes to the already-normalized `chord`. */
function findByChord<T extends KeyBinding>(
	bindings: readonly T[] | undefined,
	chord: string
): T | null {
	return bindings?.find((b) => normalizeChord(b.chord) === chord) ?? null;
}

function builtinKindBinding(chord: string, kind: AnyBlockKind): KeyBinding | null {
	return findByChord(tryGetBlockKindDescriptor(kind)?.keymap, chord);
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
function builtinGlobalBinding(
	chord: string,
	activation: PluginActivation | undefined
): KeyBinding | null {
	return findByChord(GLOBAL_KEYMAP, chord) ?? pluginGlobalBinding(chord, activation);
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
	overrides?: KeybindingOverrideMap,
	activation?: PluginActivation
): KeyBinding | null {
	const override = overrideTier(overrides, kind, chord);
	if (override !== undefined) return override;
	return builtinKindBinding(chord, kind) ?? builtinGlobalBinding(chord, activation);
}

/**
 * True when the built-in or plugin-global keymap binds this exact chord BEFORE any consumer
 * override — never a modified variant like `Mod+Alt+Y`. Override-BLIND by design: it answers
 * which chords carry a native browser default to suppress, not which command runs. A dispatch
 * question reads `runGlobalChord`/`runGlobalChordOnKind`, which consult the override tier.
 */
export function isDefaultGlobalChord(chord: string, activation?: PluginActivation): boolean {
	return builtinGlobalBinding(chord, activation) !== null;
}

/**
 * Resolve a chord at GLOBAL scope only, for input-layer sites with no focused block for a kind
 * tier to apply to: a consumer global override, else the editor-global keymap.
 */
export function resolveGlobalBinding(
	chord: string,
	overrides?: KeybindingOverrideMap,
	activation?: PluginActivation
): KeyBinding | null {
	const decision = overrideDecision(lookupOverride(overrides, 'global', chord));
	if (decision !== undefined) return decision;
	return builtinGlobalBinding(chord, activation);
}

/** Reading mode consumes a claimed chord and runs nothing: falling through would hand a
 *  read-only document the browser's own history. */
export interface GlobalChordContext extends GlobalCommandContext {
	isReading: boolean;
}

/**
 * Run whatever `chord` claims at global scope, for the surfaces with no focused block for a kind
 * tier to apply to — the editor root's windowed-out caret, the gap caret's proxy. True means the
 * press was CONSUMED, which a disabled chord is without running anything.
 */
export function runGlobalChord(
	chord: string,
	overrides: KeybindingOverrideMap | undefined,
	context: GlobalChordContext
): boolean {
	return runClaimedGlobalChord(
		resolveGlobalBinding(chord, overrides, context.activation),
		chord,
		context,
		false
	);
}

/**
 * The same, for a block that IS its own focus target: no inner leaf carries the global tier for
 * it, so resolution takes the leaf precedence and a consumer's KIND-scoped rebind reaches here.
 */
export function runGlobalChordOnKind(
	chord: string,
	kind: AnyBlockKind,
	overrides: KeybindingOverrideMap | undefined,
	context: GlobalChordContext
): boolean {
	return runClaimedGlobalChord(
		resolveBinding(chord, kind, overrides, context.activation),
		chord,
		context,
		true
	);
}

/** A chord the built-in tables bind is consumed whatever an override left it resolving to: the
 *  fall-through is the browser's own history, which bypasses the CST undo stack. */
function runClaimedGlobalChord(
	binding: KeyBinding | null,
	chord: string,
	context: GlobalChordContext,
	kindDispatchBelow: boolean
): boolean {
	const run = binding ? getCommand(binding.command) : undefined;
	const consumed = !!run || isDefaultGlobalChord(chord, context.activation);
	// A resolved binding no global command backs is dead only where nothing else can answer it:
	// consumed here and inert, or declined at a surface with no kind dispatch under it. A kind
	// keymap chord declining INTO that dispatch is the normal handoff.
	if (binding && !run && (consumed || !kindDispatchBelow)) {
		warnDeadKeyCommand(binding.command, 'global-chord');
	}
	if (!consumed) return false;
	if (!context.isReading) run?.(context);
	return true;
}
