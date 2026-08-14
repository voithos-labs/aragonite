/**
 * The `(kind, id) → handler` block-command registry and every dispatch seam over it. Chord
 * dispatch (leaf and container-bubble) resolves a chord to an id and enters `runCommandById`,
 * which the editor's `runCommand` door enters directly, so the rules that hold regardless of
 * invocation live at one seam. Register-once, throw-on-duplicate (culture.md "Registries are
 * code, not state"). Here, not `./commands`: `commands → block-commands → command-id` cycles.
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
	SINGLE_BLOCK_RANGE_COMMAND_IDS,
	type CommandDispatchPath,
	type GlobalCommandContext
} from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';
import { currentInstallingPlugin, type EditorContext } from './plugin-install';
import { isReadingMode } from '../presentation-mode';

export interface BlockCommandContext {
	/** Read context — a bytes-readonly view; metadata edits go through `updateMetadata`. */
	node: NodeView;
	arg: unknown;
	updateMetadata(patch: Record<string, unknown>): void;
	/**
	 * The mounted component's view-state hooks, which a render-primary plugin casts to its own
	 * hooks type. `undefined` when no component is mounted, and a handler must decline
	 * gracefully then; the platform never learns the shape (`unknown` by design).
	 */
	hooks?: unknown;
	/** The dispatching instance's per-plugin EditorContext (document/events/options reads).
	 *  Undefined when the target surface has no instance wiring. */
	editor?: EditorContext;
}

export type BlockCommandHandler = (ctx: BlockCommandContext) => boolean;

const blockCommands = new Map<string, BlockCommandHandler>();

const compositeKey = (kind: AnyBlockKind, id: string): string => `${kind} ${id}`;

/**
 * Register-once check precedes the mint, so a duplicate `(kind, name)` reports as
 * "register-once" rather than as an already-minted collision. The name-validating mint runs
 * inside `apply` before the map write, so an invalid name never leaves an orphaned handler.
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
 * Editor state a command's admissibility reads, whatever invoked it. Getters, never values:
 * both change under a live editor between one dispatch and the next. `isCrossBlockRange` is
 * required, so a new dispatch site cannot silently skip the range decline.
 */
export interface CommandGates {
	getPresentationMode?: GlobalCommandContext['getPresentationMode'];
	/** True while a cross-block range is painted. */
	isCrossBlockRange(): boolean;
}

/** What leaf dispatch and the `runCommand` door hand the seam: the gates plus the global tier. */
export type CommandDispatchContext = GlobalCommandContext & CommandGates;

export interface KindCommandTarget {
	kind: AnyBlockKind;
	runCommand(id: AnyCommandId, arg?: unknown): boolean;
	// The node → metadata-commit bridge a minted block command resolves against, supplied by the
	// surfaces holding the focused node and a commit route. A target omitting it resolves no
	// minted command, and dispatch falls through to `runCommand`.
	getCommandContext?(): Omit<BlockCommandContext, 'arg'>;
}

/**
 * A contained plugin command failure. A block command reports its `kind`; a global command
 * reports its `plugin` and carries no kind. The dispatch seam hands this to the caller's sink,
 * which routes it to the editor's error channel (`origin: 'command'`, `editor-events.ts`) —
 * caller-injected so this schema leaf keeps no edge to the shell owning the event surface.
 */
export interface CommandErrorReport {
	kind?: AnyBlockKind;
	command: AnyCommandId;
	plugin?: string;
	error: unknown;
}
export type CommandErrorSink = (report: CommandErrorReport) => void;

/**
 * The one seam both dispatchers route a minted `(kind, id)` command through. Containment is
 * unconditional — the safety guarantee lives here, not at the call sites, so an unwired caller
 * still turns a plugin throw into a no-op, it just doesn't report. `'unresolved'` means no
 * handler or no command context, so the caller falls through to its own tiers.
 */
function runMintedCommand(
	target: KindCommandTarget,
	id: AnyCommandId,
	arg: unknown,
	onCommandError?: CommandErrorSink
): boolean | 'unresolved' {
	const handler = getBlockCommand(target.kind, id);
	if (!handler) return 'unresolved';
	const cmdCtx = target.getCommandContext?.();
	if (!cmdCtx) return 'unresolved';
	try {
		return handler({ ...cmdCtx, arg });
	} catch (error) {
		onCommandError?.({ kind: target.kind, command: id, error });
		return true;
	}
}

/**
 * The block-local tail every dispatcher shares once its tier-specific prefix has declined: the
 * minted seam, else a built-in id to the target's `runCommand`. A GLOBAL id gets here only from
 * the bubble tier, which holds no `GlobalCommandContext` to run it with; both it and a
 * bound-but-unreachable plugin id decline loudly rather than reaching a `runCommand` with no arm.
 */
function runBlockLocalCommand(
	target: KindCommandTarget,
	id: AnyCommandId,
	arg: unknown,
	path: CommandDispatchPath,
	onCommandError?: CommandErrorSink
): boolean {
	if (getCommand(id)) {
		warnDeadKeyCommand(id, path);
		return false;
	}
	const minted = runMintedCommand(target, id, arg, onCommandError);
	if (minted !== 'unresolved') return minted;
	if (!isBuiltinCommandId(id)) {
		warnDeadKeyCommand(id, path);
		return false;
	}
	return target.runCommand(id, arg);
}

/**
 * The gates every entry path owes, whatever resolved the id. Reading mode is inert: the whole
 * vocabulary dead-keys, and navigation never routes through commands, so a reader loses nothing.
 * A painted cross-block range declines the single-block rewrites: the range has no one host
 * block, and an arm reached anyway would take the focused block's own offsets.
 */
function commandIsAdmissible(id: AnyCommandId, gates: CommandGates): boolean {
	if (isReadingMode(gates.getPresentationMode)) return false;
	// Called directly, not optionally: a caller without the getter throws rather than skipping the decline.
	return !(SINGLE_BLOCK_RANGE_COMMAND_IDS.has(id) && gates.isCrossBlockRange());
}

/**
 * The id-keyed seam: chord dispatch enters with a resolved binding, `EditorInstance.runCommand`
 * with the id itself, so both meet the same gates and the same arms. Precedence is the leaf
 * order: global (undo/redo) → minted block command → built-in kind command. A null target means
 * no focused surface, where the global tier still runs and the block-local tiers decline.
 */
function runResolvedCommand(
	id: AnyCommandId,
	arg: unknown,
	target: KindCommandTarget | null,
	ctx: CommandDispatchContext,
	path: CommandDispatchPath,
	onCommandError?: CommandErrorSink
): boolean {
	if (!commandIsAdmissible(id, ctx)) return false;
	const globalRun = getCommand(id);
	// Inject the sink so a plugin-global handler's contained throw reports through the same
	// channel as a block command's; the global tier is the only path reaching one.
	if (globalRun) return globalRun({ ...ctx, onCommandError });
	if (!target) return false;
	return runBlockLocalCommand(target, id, arg, path, onCommandError);
}

/**
 * The door's admissibility read, asked at the seam that would run the command, so a host greys an
 * affordance out instead of hiding it. False wherever the door declines before dispatch: the gates
 * above, a block-local id with no focused surface, and an id no built-in arm answers (a minted
 * command is chord-only, so the door never reaches one). True is REACHABILITY: the focused
 * surface's own arm still decides whether it writes.
 */
export function canRunCommandById(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	gates: CommandGates
): boolean {
	if (!commandIsAdmissible(id, gates)) return false;
	if (getCommand(id)) return true;
	return target !== null && isBuiltinCommandId(id);
}

/** The `EditorInstance.runCommand` door: an id with no keystroke behind it. */
export function runCommandById(
	id: AnyCommandId,
	arg: unknown,
	target: KindCommandTarget | null,
	ctx: CommandDispatchContext,
	onCommandError?: CommandErrorSink
): boolean {
	return runResolvedCommand(id, arg, target, ctx, 'door', onCommandError);
}

/** Leaf-path chord dispatch (the focused editable/chrome surface). */
export function dispatchKeyCommand(
	chord: string,
	target: KindCommandTarget,
	ctx: CommandDispatchContext,
	overrides?: KeybindingOverrideMap,
	onCommandError?: CommandErrorSink
): boolean {
	const binding = resolveBinding(chord, target.kind, overrides);
	if (!binding) return false;
	return runResolvedCommand(binding.command, binding.arg, target, ctx, 'chord', onCommandError);
}

/**
 * Container-bubble dispatch. Kind-only, no global tier: undo/redo belong to the focused leaf,
 * and a container bubble re-firing them would double-fire (`resolveKindBinding` in `./commands`).
 * The bubble callers hold no GlobalCommandContext, so they pass the gates directly — and an
 * override that resolves a GLOBAL id here declines loudly in the block-local tail rather than
 * being dropped by a `runCommand` that has no arm for it.
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
	return runBlockLocalCommand(target, binding.command, binding.arg, 'chord', onCommandError);
}
