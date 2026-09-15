/**
 * The command ids, the global command registry, and chord-to-binding resolution. Global commands
 * (undo/redo) are plain functions over a small context; block commands run on the focused block
 * or a registered block-command handler. The chord dispatchers live in `./block-commands`, so this
 * file has no runtime import of it. It may not import the editor's action contracts either, so
 * `GlobalCommandContext` is the shape `HistoryActions` happens to satisfy.
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
// Type-only imports, so this file has no runtime dependency on plugin-install or block-commands.
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
	// Bound on `tableCell` (the block that holds the caret) but named for their subject: each takes
	// the focused cell's row or column as its index, supplied from the cell's own props.
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
 * Commands that rewrite one block and have no cross-block form: dispatch declines them outright
 * while a selection spans blocks. Membership is about what the handler does, not the id's prefix:
 * the link card writes over one block's offsets and a heading level belongs to one block, so a
 * range spanning blocks leaves neither anything to act on.
 */
export const RANGE_DECLINED_COMMAND_IDS: ReadonlySet<string> = new Set<CommandId>([
	'link.openCard',
	'heading.cycle'
]);

/**
 * Single-block commands that also have a cross-block form
 * (`selection/cross-block/format-toggle.ts`), reached through an injected router. Declined
 * wherever no router was passed, so a dispatch site that skips it cannot fall through to the
 * focused block's own offsets.
 */
export const CROSS_BLOCK_RANGE_COMMAND_IDS: ReadonlySet<string> = new Set<CommandId>([
	'format.toggleStrong',
	'format.toggleEmphasis',
	'format.toggleStrikethrough',
	'format.toggleCode'
]);

/**
 * The command ids a host's selection toolbar invokes through `EditorInstance.runCommand`; the
 * other ids stay internal. Every id here is in one of the two sets above, so `canRunCommand` can
 * tell a toolbar which of its buttons a cross-block selection leaves nothing to act on.
 */
export const TOOLBAR_COMMANDS = {
	toggleStrong: 'format.toggleStrong',
	toggleEmphasis: 'format.toggleEmphasis',
	toggleStrikethrough: 'format.toggleStrikethrough',
	toggleCode: 'format.toggleCode',
	/** The link editor Mod+K opens: over a selection it creates, inside a link it edits. */
	editLink: 'link.openCard',
	/** The heading picker's command, taking the level as its argument; 0 is normal text. */
	setHeading: 'heading.cycle'
} as const satisfies Record<string, CommandId>;

/** Minimal context a global command needs; HistoryActions is structurally compatible. */
export interface GlobalCommandContext {
	history: { requestUndo(): void | Promise<void>; requestRedo(): void | Promise<void> };
	/** Per-instance context lookup, threaded from the dispatching editor; it resolves nothing
	 *  for a plugin installed in the process that this editor did not activate. */
	pluginEditor?: (pluginName: string) => EditorContext | undefined;
	/** The plugins the dispatching editor activated, so a plugin's global chord (registered
	 *  process-wide) fires only where its plugin is active. Required but nullable: a new dispatch
	 *  context must answer, and `undefined` is the answer of a caller with no editor instance. */
	activation: PluginActivation | undefined;
	/** The effective presentation mode, read live; the reading-mode check reads this, not the
	 *  plugin lookup. Absent (a history-only context) means source mode. */
	getPresentationMode?: () => PresentationMode;
	/** Injected by `dispatchKeyCommand`; receives a caught handler throw. */
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

/** Which dispatch path found the command dead. Half the memo key below: a no-op on one path must
 *  not use up the one-time warning another path still has to give. */
export type CommandDispatchPath = 'chord' | 'door' | 'plugin-global' | 'global-chord';

const warnedDeadKeys = new Set<string>();

/**
 * Dev-warn once per (id, path) that a command reached no runnable handler on `path`: a key that
 * does nothing. Unreachable, not unregistered: a plugin command resolves only where the dispatch
 * target supplies a command context.
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

// ── Plugin-global chords ─────────────────────────────────────────────────
// A plugin's global command may bind a chord here. It resolves last, after every override and
// built-in table, and built-in chords cannot be taken (register-once, throw on collision).

/** A plugin-global binding plus the plugin that installed it, so an editor's activation decides
 *  whether the chord applies there. A null owner always applies. */
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
 * `candidateCommand` is the id the incoming registration will bind (the name is the id). A
 * dev-server re-evaluation re-binding its own command to its own chord is a harmless replace, not
 * a collision; reserved chords and cross-command collisions still throw.
 */
export function assertPluginGlobalChordAvailable(
	rawChord: string,
	candidateCommand?: string
): void {
	// Throws rather than warn-and-drop: a malformed chord (`'Ctrl+B'` collapsing to a bare `'B'`)
	// would bind a handler that fires on every plain keypress. Thrown before the id is created
	// (`global-commands.ts`), so a rejected registration leaves no orphaned command.
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

/** The one activation check: every read of a plugin-global chord passes through it, and an
 *  absent activation means every installed plugin. */
function claimedHere(
	entry: PluginGlobalBinding,
	activation: PluginActivation | undefined
): boolean {
	return entry.plugin === null || activation === undefined || activation.isActive(entry.plugin);
}

export function pluginGlobalBinding(
	chord: string,
	activation: PluginActivation | undefined
): KeyBinding | null {
	const entry = findByChord(pluginGlobalKeymap, chord);
	return entry && claimedHere(entry, activation) ? entry : null;
}

/** Every plugin-global chord bound for `activation`. Registration is process-global, so an
 *  absent activation reports the plugins any mounted editor installed. */
export function pluginGlobalChords(activation: PluginActivation | undefined): readonly string[] {
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
 * The consumer-override level shared by leaf and container resolution: kind override, then global.
 * `null` is a disable; `undefined` means neither scope had an entry.
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

/** The built-in global keymap, then the plugin-global chords: the shared tail of leaf
 *  resolution and both global-only resolvers. */
function builtinGlobalBinding(
	chord: string,
	activation: PluginActivation | undefined
): KeyBinding | null {
	return findByChord(GLOBAL_KEYMAP, chord) ?? pluginGlobalBinding(chord, activation);
}

/**
 * Resolution for a chord that bubbled to a container: override(kind), override(global), then the
 * built-in kind keymap. No built-in global fallthrough: undo/redo belong to the focused leaf, and
 * a container re-firing them would double-fire. Consumer overrides do apply at both scopes, so a
 * global disable unbinds a chord a kind defines, and a global bind shadows the kind binding.
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
	overrides: KeybindingOverrideMap | undefined,
	activation: PluginActivation | undefined
): KeyBinding | null {
	const override = overrideTier(overrides, kind, chord);
	if (override !== undefined) return override;
	return builtinKindBinding(chord, kind) ?? builtinGlobalBinding(chord, activation);
}

/**
 * True when the built-in keymap, or a plugin-global chord active under `activation`, binds this
 * exact chord before any consumer override; never a modified variant like `Mod+Alt+Y`. Ignores
 * overrides on purpose: it answers which chords have a browser default to suppress, not which
 * command runs. `runGlobalChord`/`runGlobalChordOnKind` answer the dispatch question.
 */
export function isDefaultGlobalChord(
	chord: string,
	activation: PluginActivation | undefined
): boolean {
	return builtinGlobalBinding(chord, activation) !== null;
}

/**
 * Resolve a chord at global scope only, for the input sites with no focused block whose kind
 * keymap could apply: a consumer global override, else the editor-global keymap.
 */
export function resolveGlobalBinding(
	chord: string,
	overrides: KeybindingOverrideMap | undefined,
	activation: PluginActivation | undefined
): KeyBinding | null {
	const decision = overrideDecision(lookupOverride(overrides, 'global', chord));
	if (decision !== undefined) return decision;
	return builtinGlobalBinding(chord, activation);
}

/** Reading mode consumes a bound chord and runs nothing: falling through would hand a read-only
 *  document the browser's own undo history. */
export interface GlobalChordContext extends GlobalCommandContext {
	isReading: boolean;
}

/**
 * Run whatever `chord` binds at global scope, for the places with no focused block whose kind
 * keymap could apply: the editor root holding a caret in an unmounted block, the gap caret's
 * proxy. True means the keypress was consumed, which a disabled chord is without running anything.
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
 * The same for a block that is its own focus target: no inner leaf resolves global chords for it,
 * so resolution takes the leaf precedence and a consumer's kind-scoped rebind reaches here.
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
	// consumed here and inert, or declined at a block with no kind dispatch under it. A kind keymap
	// chord declining into that dispatch is the normal handoff.
	if (binding && !run && (consumed || !kindDispatchBelow)) {
		warnDeadKeyCommand(binding.command, 'global-chord');
	}
	if (!consumed) return false;
	if (!context.isReading) run?.(context);
	return true;
}
