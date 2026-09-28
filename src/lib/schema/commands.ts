/**
 * The command ids, the global command registry, and chord-to-binding resolution. Global commands
 * (undo/redo) are plain functions over a small context; block commands run on the focused block.
 * The chord dispatchers live in `./block-commands`, and the editor's actions satisfy
 * `GlobalCommandContext` by shape, so this file imports neither at runtime.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { AnyCommandId } from './command-id';
import { devWarn } from '../dev-warn';
import { devReplacesRegistration } from './register-once';
import { enrollTestReset } from './registry-reset';
import { createPluginRegistry } from './plugin-registry';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { eventToChord, registeredChord, type KeyBinding } from './keybindings';
import {
	lookupOverride,
	overrideDecision,
	type KeybindingOverrideMap
} from './keybinding-overrides';
// Type-only imports, so this file has no runtime dependency on plugin-install or block-commands.
import type { EditorContext } from './plugin-install';
import type { PluginActivation } from './plugin-activation';
import type { CommandDispatchContext, CommandErrorSink } from './block-commands';
import { isReadingMode, type PresentationMode } from '../presentation-mode';

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
	'list.toggleTask',
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
 * Commands that rewrite one block and have no cross-block form, declined while a selection spans
 * blocks. Membership follows what the handler does (the link card, a heading level), not the id.
 */
export const RANGE_DECLINED_COMMAND_IDS: ReadonlySet<string> = new Set<CommandId>([
	'link.openCard',
	'heading.cycle'
]);

/** Built-in commands that move the block or row holding the caret rather than the caret. */
export const BLOCK_MOVE_COMMAND_IDS: ReadonlySet<string> = new Set<CommandId>([
	'block.moveUp',
	'block.moveDown',
	'table.moveRowUp',
	'table.moveRowDown'
]);

/**
 * Single-block commands with a cross-block form (`selection/cross-block/format-toggle.ts`),
 * declined wherever no router was injected so they never fall through to the focused block.
 */
export const CROSS_BLOCK_RANGE_COMMAND_IDS: ReadonlySet<string> = new Set<CommandId>([
	'format.toggleStrong',
	'format.toggleEmphasis',
	'format.toggleStrikethrough',
	'format.toggleCode'
]);

/**
 * The ids a host's selection toolbar invokes through `EditorInstance.runCommand`. Each is in one of
 * the two sets above, so `canRunCommand` can tell a toolbar which buttons a range leaves idle.
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
	 *  process-wide) fires only where its plugin is active; `everyInstalledPlugin` with no editor. */
	activation: PluginActivation;
	/** The effective presentation mode, read live; the reading-mode check reads this, not the
	 *  plugin lookup. */
	getPresentationMode: () => PresentationMode;
	/** Receives a caught handler throw. */
	onCommandError: CommandErrorSink;
	/** The argument `runCommand(id, arg)` or the chord's binding carried, injected per dispatch. */
	arg?: unknown;
}

export type GlobalCommandRun = (ctx: GlobalCommandContext) => boolean;

const BUILTIN_COMMAND_IDS = new Set<string>([...GLOBAL_COMMAND_IDS, ...BLOCK_COMMAND_IDS]);

/** True when the id is in the closed built-in vocabulary. Takes a plain, unbranded name. */
export function isBuiltinCommandId(id: string): boolean {
	return BUILTIN_COMMAND_IDS.has(id);
}

const globalCommands = createPluginRegistry<AnyCommandId, GlobalCommandRun>({
	label: 'registerCommand',
	isBuiltin: isBuiltinCommandId
});

export function registerCommand(id: AnyCommandId, run: GlobalCommandRun): void {
	globalCommands.register(
		id,
		run,
		`registerCommand: "${id}" is already registered. Commands are register-once.`
	);
}

/** The command's handler where `activation` resolves the plugin that registered it. */
export function getCommand(
	id: AnyCommandId,
	activation: PluginActivation
): GlobalCommandRun | undefined {
	return globalCommands.get(id, activation);
}

/** Whether any plugin or built-in registered the id, whatever the activation. */
export function isCommandRegistered(id: AnyCommandId): boolean {
	return globalCommands.has(id);
}

/** The plugin whose setup registered a global command, read at dispatch like a block command's. */
export function globalCommandOwner(id: AnyCommandId): string | null {
	return globalCommands.ownerOf(id);
}

/** Runs a plugin's command handler, global or block, and reports a throw as the plugin's that
 *  registered it; a contained throw still counts as handled, so the key goes no further. */
export function runPluginCommand(
	owner: string | null,
	failure: { command: AnyCommandId; kind?: AnyBlockKind },
	onCommandError: CommandErrorSink,
	run: () => boolean
): boolean {
	try {
		return run();
	} catch (error) {
		onCommandError({ ...failure, plugin: owner ?? undefined, error });
		return true;
	}
}

/** Which dispatch path found the command dead. Half the memo key below: a no-op on one path must
 *  not use up the one-time warning another path still has to give. */
export type CommandDispatchPath = 'chord' | 'door' | 'plugin-global' | 'global-chord';

const warnedDeadKeys = new Set<string>();

/**
 * Dev-warn once per (id, path) that a command reached no runnable handler: a key that does nothing.
 * Unreachable rather than unregistered: a plugin command needs the target's command context.
 */
export function warnDeadKeyCommand(id: AnyCommandId, path: CommandDispatchPath): void {
	const key = `${path} ${id}`;
	if (warnedDeadKeys.has(key)) return;
	warnedDeadKeys.add(key);
	devWarn('commands', `command "${id}" reached no handler on the ${path} path; key is dead`);
}

/** Test-only. Clears the dead-key warn memo so each test sees a first-time warn. */
function __resetCommandWarningsForTests(): void {
	warnedDeadKeys.clear();
}
enrollTestReset(__resetCommandWarningsForTests);

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

// Keyed by the normalized chord, so a chord binds at most one command.
const pluginGlobalKeymap = createPluginRegistry<string, KeyBinding>({
	label: 'registerPluginGlobalBinding',
	isBuiltin: () => false
});

// Chords the editor UI intercepts outside the command resolvers (the search bar's
// document-level listener): a plugin binding one would fire twice on a single keypress.
const RESERVED_UI_CHORDS = new Set(['Mod+F', 'Mod+H']);

/**
 * True when the editor UI intercepts a normalized chord outside the command resolvers. The single
 * source both the plugin-global registration guard and the editor-root keydown handler read.
 */
export function isReservedUiChord(chord: string): boolean {
	return RESERVED_UI_CHORDS.has(chord);
}

/** The same pair, for the callers that must enumerate it rather than test one chord. */
export function reservedUiChords(): readonly string[] {
	return [...RESERVED_UI_CHORDS];
}

/** The chord's normal form, or a throw when it can't be bound. A dev-server re-evaluation binding
 *  `candidateCommand` to its own chord again replaces the binding rather than colliding. */
export function assertPluginGlobalChordAvailable(
	rawChord: string,
	candidateCommand?: string
): string {
	// Thrown before the id is created (`global-commands.ts`), so a rejected registration leaves
	// no orphaned command.
	const chord = registeredChord(rawChord, 'registerGlobalCommand');
	if (isReservedUiChord(chord)) {
		throw new Error(
			`plugin global chord "${rawChord}" is reserved by the editor UI (search): pick another chord`
		);
	}
	// Activation-blind: registration is process-global register-once, so a chord no editor
	// has activated yet, or a failed plugin's, still collides.
	const collision =
		findByChord(GLOBAL_KEYMAP, chord) ?? pluginGlobalKeymap.getIgnoringActivation(chord);
	if (collision) {
		if (devReplacesRegistration() && collision.command === candidateCommand) return chord;
		throw new Error(
			`plugin global chord "${rawChord}" is already bound to "${collision.command}": global chords are register-once`
		);
	}
	return chord;
}

export function registerPluginGlobalBinding(binding: KeyBinding): void {
	const chord = assertPluginGlobalChordAvailable(binding.chord, binding.command);
	// The check above already let a dev re-evaluation of the same command through, so the
	// registry's own duplicate rule only ever replaces here.
	pluginGlobalKeymap.register(chord, { ...binding, chord });
}

export function pluginGlobalBinding(
	chord: string,
	activation: PluginActivation
): KeyBinding | null {
	return pluginGlobalKeymap.get(chord, activation) ?? null;
}

/** Every plugin-global binding `activation` resolves, each with the plugin that installed it. */
export function pluginGlobalBindings(
	activation: PluginActivation
): readonly (KeyBinding & { plugin: string | null })[] {
	return pluginGlobalKeymap
		.entries(activation)
		.map(([chord, binding]) => ({ ...binding, plugin: pluginGlobalKeymap.ownerOf(chord) }));
}

/** The chords of {@link pluginGlobalBindings}, normalized. */
export function pluginGlobalChords(activation: PluginActivation): readonly string[] {
	return pluginGlobalKeymap.entries(activation).map(([chord]) => chord);
}

/** First binding in `bindings` for `chord`; every stored chord is normalized already. */
function findByChord(bindings: readonly KeyBinding[], chord: string): KeyBinding | null {
	return bindings.find((b) => b.chord === chord) ?? null;
}

// A block focused as a whole has no text keymap to hold the reorder chords, so it gets them here
// unless its kind binds the chord; added on read, so a changed `blockFocus` leaves none stale.
const WHOLE_BLOCK_KEYMAP: readonly KeyBinding[] = [
	{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Alt+ArrowDown', command: 'block.moveDown' }
];

/** The bindings a kind resolves: its declared keymap, plus the whole-block defaults above. */
export function kindKeymap(kind: AnyBlockKind): readonly KeyBinding[] {
	const descriptor = tryGetBlockKindDescriptor(kind);
	const declared = descriptor?.keymap ?? [];
	if (descriptor?.blockFocus !== 'whole-block') return declared;
	const bound = new Set(declared.map((binding) => binding.chord));
	return [...declared, ...WHOLE_BLOCK_KEYMAP.filter((binding) => !bound.has(binding.chord))];
}

function builtinKindBinding(chord: string, kind: AnyBlockKind): KeyBinding | null {
	return findByChord(kindKeymap(kind), chord);
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
function builtinGlobalBinding(chord: string, activation: PluginActivation): KeyBinding | null {
	return findByChord(GLOBAL_KEYMAP, chord) ?? pluginGlobalBinding(chord, activation);
}

/**
 * A chord bubbled to a container: override(kind), override(global), then the built-in kind keymap.
 * No built-in global fallthrough, since undo/redo belong to the focused leaf and would double-fire.
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
	activation: PluginActivation
): KeyBinding | null {
	const override = overrideTier(overrides, kind, chord);
	if (override !== undefined) return override;
	return builtinKindBinding(chord, kind) ?? builtinGlobalBinding(chord, activation);
}

/**
 * The command a keypress names at `kind`, overrides included, without running it; a keypress
 * with no block under it (a null kind) resolves at global scope.
 */
export function commandForKey(
	e: KeyboardEvent,
	kind: AnyBlockKind | null,
	ctx: Pick<CommandDispatchContext, 'keybindingOverrides' | 'activation'>
): AnyCommandId | null {
	const chord = eventToChord(e);
	if (!chord) return null;
	const overrides = ctx.keybindingOverrides();
	const binding =
		kind === null
			? resolveGlobalBinding(chord, overrides, ctx.activation)
			: resolveBinding(chord, kind, overrides, ctx.activation);
	return binding?.command ?? null;
}

/**
 * Whether the built-in keymap or an active plugin-global chord binds this exact chord, ignoring
 * overrides: the question is which chords have a browser default to suppress, not what runs.
 */
export function isDefaultGlobalChord(chord: string, activation: PluginActivation): boolean {
	return builtinGlobalBinding(chord, activation) !== null;
}

/**
 * Resolve a chord at global scope only, for the input sites with no focused block whose kind
 * keymap could apply: a consumer global override, else the editor-global keymap.
 */
export function resolveGlobalBinding(
	chord: string,
	overrides: KeybindingOverrideMap | undefined,
	activation: PluginActivation
): KeyBinding | null {
	const decision = overrideDecision(lookupOverride(overrides, 'global', chord));
	if (decision !== undefined) return decision;
	return builtinGlobalBinding(chord, activation);
}

/**
 * Run what `chord` binds at global scope where no focused block's keymap applies (a caret in an
 * unmounted block, the gap caret). True means consumed, which a disabled chord is too.
 */
export function runGlobalChord(chord: string, context: CommandDispatchContext): boolean {
	const binding = resolveGlobalBinding(chord, context.keybindingOverrides(), context.activation);
	return runClaimedGlobalChord(binding, chord, context, false);
}

/**
 * The same for a block that is its own focus target: no inner leaf resolves global chords for it,
 * so resolution takes the leaf precedence and a consumer's kind-scoped rebind reaches here.
 */
export function runGlobalChordOnKind(
	chord: string,
	kind: AnyBlockKind,
	context: CommandDispatchContext
): boolean {
	const overrides = context.keybindingOverrides();
	const binding = resolveBinding(chord, kind, overrides, context.activation);
	return runClaimedGlobalChord(binding, chord, context, true);
}

/** A chord the built-in tables bind is consumed whatever an override resolves it to, since the
 *  browser's own undo would bypass the CST undo stack; reading mode consumes it, runs nothing. */
function runClaimedGlobalChord(
	binding: KeyBinding | null,
	chord: string,
	context: CommandDispatchContext,
	kindDispatchBelow: boolean
): boolean {
	const run = binding ? getCommand(binding.command, context.activation) : undefined;
	const consumed = !!run || isDefaultGlobalChord(chord, context.activation);
	// A binding no global command backs is dead only where nothing else can answer it; a kind
	// keymap chord declining into the block's own dispatch is the normal handoff.
	if (binding && !run && (consumed || !kindDispatchBelow)) {
		warnDeadKeyCommand(binding.command, 'global-chord');
	}
	if (!consumed) return false;
	if (!isReadingMode(context.getPresentationMode)) run?.({ ...context, arg: binding?.arg });
	return true;
}
