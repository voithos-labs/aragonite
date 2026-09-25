/**
 * The `(kind, id) → handler` registry of block commands and every dispatch path over it. A chord
 * on a leaf or a container, `EditorInstance.runCommand`, and the "can this run" read all resolve
 * through the same lookup, so a rule that holds however a command was invoked is enforced once.
 * Register-once, throw on duplicate. Not in `./commands`: `commands → block-commands → command-id`
 * would be an import cycle.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	mintCommandId,
	__resetMintedCommandIdsForTests,
	type AnyCommandId,
	type PluginCommandId
} from './command-id';
import { registerOnce } from './register-once';
import {
	resolveBinding,
	resolveKindBinding,
	getCommand,
	warnDeadKeyCommand,
	isBuiltinCommandId,
	CROSS_BLOCK_RANGE_COMMAND_IDS,
	RANGE_DECLINED_COMMAND_IDS,
	type CommandDispatchPath,
	type GlobalCommandContext,
	type GlobalCommandRun
} from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';
import { currentInstallingPlugin, type EditorContext } from './plugin-install';
import { isReadingMode } from '../presentation-mode';

export interface BlockCommandContext {
	/** A read-only view of the node; metadata edits go through `updateMetadata`. */
	node: NodeView;
	arg: unknown;
	updateMetadata(patch: Record<string, unknown>): void;
	/**
	 * The mounted component's view-state hooks, which the plugin casts to its own hooks type;
	 * the editor never learns the shape. `undefined` when no component is mounted, and a handler
	 * must decline cleanly then.
	 */
	hooks?: unknown;
	/** The dispatching editor's per-plugin `EditorContext` (document, events, options).
	 *  Undefined when the target block is not wired to an editor instance. */
	editor?: EditorContext;
}

export type BlockCommandHandler = (ctx: BlockCommandContext) => boolean;

const blockCommands = new Map<string, BlockCommandHandler>();

const compositeKey = (kind: AnyBlockKind, id: string): string => `${kind} ${id}`;

/**
 * The duplicate check runs before `mintCommandId`, so a duplicate `(kind, name)` reports as a
 * register-once conflict rather than an id collision. `mintCommandId` validates the name inside
 * `apply`, before the map write, so an invalid name never leaves an orphaned handler.
 */
export function registerBlockCommand(
	kind: AnyBlockKind,
	name: string,
	handler: BlockCommandHandler
): PluginCommandId {
	const key = compositeKey(kind, name);
	let id: PluginCommandId | undefined;
	registerOnce(
		blockCommands.has(key),
		() => {
			id = mintCommandId(name, currentInstallingPlugin());
			blockCommands.set(key, handler);
		},
		`registerBlockCommand: (${kind}, ${name}) is already registered — block commands are register-once`
	);
	return id!;
}

export function getBlockCommand(
	kind: AnyBlockKind,
	id: AnyCommandId
): BlockCommandHandler | undefined {
	return blockCommands.get(compositeKey(kind, id));
}

export function __resetBlockCommandsForTests(): void {
	blockCommands.clear();
	__resetMintedCommandIdsForTests();
}

// ── Dispatch ─────────────────────────────────────────────────────────────

/**
 * The cross-block handler a range command routes to, injected because this schema module may not
 * import the selection code. `canRun` asks whether the handler is reachable, not whether it will
 * act: a keypress whose range reaches no block still consumes the chord and writes nothing.
 */
export interface CrossBlockCommandRouter {
	canRun(id: AnyCommandId): boolean;
	run(id: AnyCommandId): boolean;
	isActive(id: AnyCommandId): boolean;
}

/**
 * The editor state that decides whether a command may run, whatever invoked it. Getters, never
 * values: they change between one dispatch and the next. Every field is required, so a new
 * dispatch site cannot silently skip the reading-mode check, the range decline, or the
 * cross-block route; a container-bubble caller answers `undefined` for the router.
 */
export interface CommandGates {
	getPresentationMode: GlobalCommandContext['getPresentationMode'];
	/** True while a cross-block range is painted. */
	isCrossBlockRange(): boolean;
	crossBlockCommands: CrossBlockCommandRouter | undefined;
}

/** What chord dispatch and `EditorInstance.runCommand` pass in: the checks above plus the
 *  global-command context. */
export type CommandDispatchContext = GlobalCommandContext & CommandGates;

export interface KindCommandTarget {
	kind: AnyBlockKind;
	runCommand(id: AnyCommandId, arg?: unknown): boolean;
	// The node plus a metadata-commit route a plugin block command runs against, supplied by the
	// block holding the focus. A target without it resolves no plugin command, so both the dispatch
	// and the "can this run" read fall through to `runCommand`.
	getCommandContext?(): Omit<BlockCommandContext, 'arg'>;
	/** Whether the id is toggled on at this block's caret or selection, which a toolbar shows as
	 *  pressed. Absent means the block has no toggle state to report, which reads as inactive. */
	isCommandActive?(id: AnyCommandId): boolean;
}

/**
 * A caught plugin command failure. A block command reports its `kind`; a global command reports
 * its `plugin` and no kind. Dispatch hands it to the caller's callback, which routes it to the
 * editor's error event (`origin: 'command'`, `editor-events.ts`); injected by the caller so this
 * schema module imports nothing from the editor shell.
 */
export interface CommandErrorReport {
	kind?: AnyBlockKind;
	command: AnyCommandId;
	plugin?: string;
	error: unknown;
}
export type CommandErrorSink = (report: CommandErrorReport) => void;

/**
 * Which level answers an id at a target. `'dead'` is a bound id no handler on the block answers;
 * `'no-surface'` is a block-level id with nothing focused, where no handler was tried and so no
 * one-time dead-key warning is due.
 */
type BlockLocalResolution =
	| {
			tier: 'minted';
			target: KindCommandTarget;
			handler: BlockCommandHandler;
			context: Omit<BlockCommandContext, 'arg'>;
	  }
	| { tier: 'builtin'; target: KindCommandTarget }
	| { tier: 'dead' }
	| { tier: 'no-surface' };

type CommandResolution = { tier: 'global'; run: GlobalCommandRun } | BlockLocalResolution;

/**
 * The block-level lookups, in dispatch order. A global id resolves as dead here: the leaf path has
 * already run it, and the container bubble has no global level on purpose, so a container can
 * never re-fire the focused leaf's undo.
 */
function resolveBlockLocalCommand(
	id: AnyCommandId,
	target: KindCommandTarget | null
): BlockLocalResolution {
	if (!target) return { tier: 'no-surface' };
	if (getCommand(id)) return { tier: 'dead' };
	const handler = getBlockCommand(target.kind, id);
	// A context is built only where a handler matched, so a built-in id costs nothing extra on the
	// read a host may run per selection change.
	const context = handler ? target.getCommandContext?.() : undefined;
	if (handler && context) return { tier: 'minted', target, handler, context };
	return isBuiltinCommandId(id) ? { tier: 'builtin', target } : { tier: 'dead' };
}

/** The full lookup: global commands first, then the block-level ones. Both the dispatch and the
 *  "can this run" read use it, so a greyed-out button cannot disagree with the click under it. */
function resolveCommand(id: AnyCommandId, target: KindCommandTarget | null): CommandResolution {
	const globalRun = getCommand(id);
	if (globalRun) return { tier: 'global', run: globalRun };
	return resolveBlockLocalCommand(id, target);
}

/**
 * Run a resolved block-level command. A plugin throw is always caught here, not at the call sites,
 * so a caller with no error callback still turns it into a no-op; it just goes unreported. A dead
 * id declines with a warning rather than reaching a `runCommand` that has no handler for it.
 */
function runBlockLocalCommand(
	resolved: BlockLocalResolution,
	id: AnyCommandId,
	arg: unknown,
	path: CommandDispatchPath,
	onCommandError?: CommandErrorSink
): boolean {
	switch (resolved.tier) {
		case 'minted':
			try {
				return resolved.handler({ ...resolved.context, arg });
			} catch (error) {
				onCommandError?.({ kind: resolved.target.kind, command: id, error });
				return true;
			}
		case 'builtin':
			return resolved.target.runCommand(id, arg);
		case 'dead':
			warnDeadKeyCommand(id, path);
			return false;
		case 'no-surface':
			return false;
	}
}

/** `ranged` travels with the block-level answer because a selection no handler reads is not the
 *  same state as a caret, and only this lookup has already asked the question. */
type RangeRoute =
	| { kind: 'block-local'; ranged: boolean }
	| { kind: 'decline' }
	| { kind: 'cross-block'; router: CrossBlockCommandRouter };

/**
 * Where an id goes while a selection spans blocks. The single-block commands have no one block to
 * take their offsets from, so they either route to the cross-block handler or decline; everything
 * else is safe over a range and runs on the focused block (`RANGE_DECLINED_COMMAND_IDS`).
 */
function rangeRouteFor(id: AnyCommandId, gates: CommandGates): RangeRoute {
	// Called directly, not optionally: a caller without the getter throws rather than skipping.
	if (!gates.isCrossBlockRange()) return { kind: 'block-local', ranged: false };
	if (RANGE_DECLINED_COMMAND_IDS.has(id)) return { kind: 'decline' };
	if (!CROSS_BLOCK_RANGE_COMMAND_IDS.has(id)) return { kind: 'block-local', ranged: true };
	const router = gates.crossBlockCommands;
	return router?.canRun(id) ? { kind: 'cross-block', router } : { kind: 'decline' };
}

/**
 * The checks every entry path must pass, whatever resolved the id. Reading mode runs no command
 * at all; navigation never routes through commands, so the user loses nothing.
 */
function commandIsAdmissible(id: AnyCommandId, gates: CommandGates): boolean {
	if (isReadingMode(gates.getPresentationMode)) return false;
	return rangeRouteFor(id, gates).kind !== 'decline';
}

/**
 * The one dispatch keyed by id: chord dispatch enters with a resolved binding,
 * `EditorInstance.runCommand` with the id itself, so both meet the same checks and handlers.
 * Precedence: global (undo/redo), then a plugin block command, then a built-in kind command. A
 * null target means no focused block; global commands still run and block-level ones decline.
 */
function runResolvedCommand(
	id: AnyCommandId,
	arg: unknown,
	target: KindCommandTarget | null,
	ctx: CommandDispatchContext,
	path: CommandDispatchPath,
	onCommandError?: CommandErrorSink
): boolean {
	if (isReadingMode(ctx.getPresentationMode)) return false;
	const route = rangeRouteFor(id, ctx);
	if (route.kind === 'decline') return false;
	if (route.kind === 'cross-block') return route.router.run(id);
	const resolved = resolveCommand(id, target);
	// Pass the error callback so a plugin global command's caught throw reports through the same
	// channel as a block command's; only the global path can reach one.
	if (resolved.tier === 'global') return resolved.run({ ...ctx, onCommandError, arg });
	return runBlockLocalCommand(resolved, id, arg, path, onCommandError);
}

/**
 * The read behind `EditorInstance.canRunCommand`: the same checks and the same lookup the
 * dispatch uses, never a second derivation. Silent on purpose: a host may ask on every selection
 * change, so an unreachable id spends none of the one-time dead-key warnings. `editor-props.ts`
 * states the contract this answers.
 */
export function canRunCommandById(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	gates: CommandGates
): boolean {
	if (isReadingMode(gates.getPresentationMode)) return false;
	const route = rangeRouteFor(id, gates);
	if (route.kind !== 'block-local') return route.kind === 'cross-block';
	const { tier } = resolveCommand(id, target);
	return tier !== 'dead' && tier !== 'no-surface';
}

/** The read behind `EditorInstance.isCommandActive`, `canRunCommandById`'s sibling: state rather
 *  than permission, so a disabled button may still show as pressed. Whoever would run the command
 *  answers: the cross-block handler over a range, the focused block at a caret. */
export function isCommandActiveById(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	gates: CommandGates
): boolean {
	const route = rangeRouteFor(id, gates);
	if (route.kind === 'cross-block') return route.router.isActive(id);
	// A selection no handler reads has no pressed state: the focused block only holds a resting
	// caret, whose bytes are not the ones the command would rewrite.
	if (route.kind === 'decline' || route.ranged) return false;
	return target?.isCommandActive?.(id) ?? false;
}

/** The `EditorInstance.runCommand` entry point: an id with no keystroke behind it. */
export function runCommandById(
	id: AnyCommandId,
	arg: unknown,
	target: KindCommandTarget | null,
	ctx: CommandDispatchContext,
	onCommandError?: CommandErrorSink
): boolean {
	return runResolvedCommand(id, arg, target, ctx, 'door', onCommandError);
}

/** Chord dispatch on the focused leaf: an editable block, or a container's title row. */
export function dispatchKeyCommand(
	chord: string,
	target: KindCommandTarget,
	ctx: CommandDispatchContext,
	overrides?: KeybindingOverrideMap,
	onCommandError?: CommandErrorSink
): boolean {
	const binding = resolveBinding(chord, target.kind, overrides, ctx.activation);
	if (!binding) return false;
	return runResolvedCommand(binding.command, binding.arg, target, ctx, 'chord', onCommandError);
}

/**
 * Dispatch for a chord that bubbled up to a container. Kind commands only: undo/redo belong to the
 * focused leaf, and a container re-firing them would double-fire. An override that resolves a
 * global id here declines as dead, with a warning.
 */
export function dispatchKindCommand(
	chord: string,
	target: KindCommandTarget,
	gates: CommandGates,
	overrides?: KeybindingOverrideMap,
	onCommandError?: CommandErrorSink
): boolean {
	const binding = resolveKindBinding(chord, target.kind, overrides);
	if (!binding) return false;
	if (!commandIsAdmissible(binding.command, gates)) return false;
	const resolved = resolveBlockLocalCommand(binding.command, target);
	return runBlockLocalCommand(resolved, binding.command, binding.arg, 'chord', onCommandError);
}
