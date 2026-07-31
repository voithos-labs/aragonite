/**
 * The `(kind, id) → handler` block-command registry AND both chord dispatchers — the leaf path
 * (`dispatchKeyCommand`) and the container-bubble path (`dispatchKindCommand`), which resolve a
 * minted handler through one seam (`runMintedCommand`) rather than sibling-path copies.
 * Register-once, throw-on-duplicate (docs/contributing/culture.md "Registries are code, not
 * state"). The dispatchers live here, not `./commands`, else `commands → block-commands →
 * command-id → commands` cycles.
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
	type GlobalCommandContext
} from './commands';
import type { KeyBinding } from './keybindings';
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

// ── Chord dispatch ───────────────────────────────────────────────────────

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
	binding: KeyBinding,
	onCommandError?: CommandErrorSink
): boolean | 'unresolved' {
	const handler = getBlockCommand(target.kind, binding.command);
	if (!handler) return 'unresolved';
	const cmdCtx = target.getCommandContext?.();
	if (!cmdCtx) return 'unresolved';
	try {
		return handler({ ...cmdCtx, arg: binding.arg });
	} catch (error) {
		onCommandError?.({ kind: target.kind, command: binding.command, error });
		return true;
	}
}

/**
 * The fall-through tail both dispatchers share once their tier-specific prefix has declined:
 * the minted seam, else a built-in id to the target's `runCommand` — dev-warning a
 * bound-but-unreachable plugin id rather than handing it to a `runCommand` that can't resolve it.
 */
function runResolvedBinding(
	target: KindCommandTarget,
	binding: KeyBinding,
	onCommandError?: CommandErrorSink
): boolean {
	const minted = runMintedCommand(target, binding, onCommandError);
	if (minted !== 'unresolved') return minted;
	if (!isBuiltinCommandId(binding.command)) {
		warnUnresolvedPluginCommand(binding.command);
		return false;
	}
	return target.runCommand(binding.command, binding.arg);
}

/**
 * Leaf-path dispatch (the focused editable/chrome surface), full precedence: global
 * (undo/redo) → minted block command → built-in kind command.
 */
export function dispatchKeyCommand(
	chord: string,
	target: KindCommandTarget,
	ctx: GlobalCommandContext,
	overrides?: KeybindingOverrideMap,
	onCommandError?: CommandErrorSink
): boolean {
	// Reading mode is inert: the whole command vocabulary dead-keys at this seam, for every
	// caller at once. Navigation never routes through the keymap, so a reader loses nothing.
	if (isReadingMode(ctx.getPresentationMode)) return false;
	const binding = resolveBinding(chord, target.kind, overrides);
	if (!binding) return false;
	const globalRun = getCommand(binding.command);
	// Inject the sink so a plugin-global handler's contained throw reports through the same
	// channel as a block command's; the global tier is the only path reaching one.
	if (globalRun) return globalRun({ ...ctx, onCommandError });
	return runResolvedBinding(target, binding, onCommandError);
}

/**
 * Container-bubble dispatch. Kind-only, no global tier: undo/redo belong to the focused leaf,
 * and a container bubble re-firing them would double-fire (`resolveKindBinding` in `./commands`).
 */
export function dispatchKindCommand(
	chord: string,
	target: KindCommandTarget,
	overrides?: KeybindingOverrideMap,
	onCommandError?: CommandErrorSink,
	getPresentationMode?: GlobalCommandContext['getPresentationMode']
): boolean {
	// Sibling of dispatchKeyCommand's reading-mode gate. This path has no GlobalCommandContext,
	// so the bubble callers pass the mode getter directly.
	if (isReadingMode(getPresentationMode)) return false;
	const binding = resolveKindBinding(chord, target.kind, overrides);
	if (!binding) return false;
	return runResolvedBinding(target, binding, onCommandError);
}
