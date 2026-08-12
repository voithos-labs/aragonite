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
	warnUnresolvedPluginCommand,
	isBuiltinCommandId,
	SINGLE_BLOCK_RANGE_COMMAND_IDS,
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
 * required, so a new dispatch site cannot silently skip the range decline, which is the
 * failure that made that decline chord-keyed in the first place.
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
 * minted seam, else a built-in id to the target's `runCommand`, dev-warning a
 * bound-but-unreachable plugin id rather than handing it to a `runCommand` that can't resolve it.
 */
function runBlockLocalCommand(
	target: KindCommandTarget,
	id: AnyCommandId,
	arg: unknown,
	onCommandError?: CommandErrorSink
): boolean {
	const minted = runMintedCommand(target, id, arg, onCommandError);
	if (minted !== 'unresolved') return minted;
	if (!isBuiltinCommandId(id)) {
		warnUnresolvedPluginCommand(id);
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
	// Called directly, not optionally: the field is required so a caller without it throws
	// rather than skipping the decline, which is the whole reason it stopped being optional.
	return !(SINGLE_BLOCK_RANGE_COMMAND_IDS.has(id) && gates.isCrossBlockRange());
}

/**
 * The id-keyed seam: chord dispatch enters with a resolved binding, `EditorInstance.runCommand`
 * with the id itself, so both meet the same gates and the same arms. Precedence is the leaf
 * order: global (undo/redo) → minted block command → built-in kind command. A null target means
 * no focused surface, where the global tier still runs and the block-local tiers decline.
 */
export function runCommandById(
	id: AnyCommandId,
	arg: unknown,
	target: KindCommandTarget | null,
	ctx: CommandDispatchContext,
	onCommandError?: CommandErrorSink
): boolean {
	if (!commandIsAdmissible(id, ctx)) return false;
	const globalRun = getCommand(id);
	// Inject the sink so a plugin-global handler's contained throw reports through the same
	// channel as a block command's; the global tier is the only path reaching one.
	if (globalRun) return globalRun({ ...ctx, onCommandError });
	if (!target) return false;
	return runBlockLocalCommand(target, id, arg, onCommandError);
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
	return runCommandById(binding.command, binding.arg, target, ctx, onCommandError);
}

/**
 * Container-bubble dispatch. Kind-only, no global tier: undo/redo belong to the focused leaf,
 * and a container bubble re-firing them would double-fire (`resolveKindBinding` in `./commands`).
 * The bubble callers hold no GlobalCommandContext, so they pass the gates directly.
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
	return runBlockLocalCommand(target, binding.command, binding.arg, onCommandError);
}
