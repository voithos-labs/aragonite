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
	type GlobalCommandContext,
	type GlobalCommandRun
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
	// minted command, so the dispatch AND the admissibility read alike fall through to `runCommand`.
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
 * Which tier answers an id at a target. `'dead'` is a bound id no arm below the surface answers;
 * `'no-surface'` is the block-local id with nothing focused, where no arm was tried and so none
 * of the dispatch's one-time diagnostics is owed.
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
 * The kind tiers, in dispatch order. A GLOBAL id resolves DEAD here: the leaf path has already
 * run it, and the container bubble deliberately has no global tier, so a container can never
 * re-fire the focused leaf's undo.
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

/** The full walk: global first, then the kind tiers. Both the dispatch and the admissibility
 *  read spend this one, so a greyed affordance cannot disagree with the click under it. */
function resolveCommand(id: AnyCommandId, target: KindCommandTarget | null): CommandResolution {
	const globalRun = getCommand(id);
	if (globalRun) return { tier: 'global', run: globalRun };
	return resolveBlockLocalCommand(id, target);
}

/**
 * Spend a resolved kind tier. Containment is unconditional — the safety guarantee lives here, not
 * at the call sites, so an unwired caller still turns a plugin throw into a no-op, it just doesn't
 * report. A dead id declines loudly rather than reaching a `runCommand` with no arm for it.
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
	const resolved = resolveCommand(id, target);
	// Inject the sink so a plugin-global handler's contained throw reports through the same
	// channel as a block command's; the global tier is the only path reaching one.
	if (resolved.tier === 'global') return resolved.run({ ...ctx, onCommandError });
	return runBlockLocalCommand(resolved, id, arg, path, onCommandError);
}

/**
 * The door's admissibility read: the gates plus the same tier walk the dispatch spends, never a
 * second derivation of them. Silent by design — a host may ask on every selection change, so an
 * unreachable id spends none of the dispatch's one-time dead-key diagnostics.
 * See `editor-props.ts` for the contract this answers.
 */
export function canRunCommandById(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	gates: CommandGates
): boolean {
	if (!commandIsAdmissible(id, gates)) return false;
	const { tier } = resolveCommand(id, target);
	return tier !== 'dead' && tier !== 'no-surface';
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
	const resolved = resolveBlockLocalCommand(binding.command, target);
	return runBlockLocalCommand(resolved, binding.command, binding.arg, 'chord', onCommandError);
}
