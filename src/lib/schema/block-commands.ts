/**
 * The `(kind, id) → handler` block-command registry AND both chord dispatchers —
 * the leaf path (`dispatchKeyCommand`, the focused editable/chrome surface) and the
 * container-bubble path (`dispatchKindCommand`). A plugin mints a command id here
 * and binds it to a block kind; both dispatchers resolve a minted handler through
 * one seam (`runMintedCommand`) — no forked registry read, no sibling-path copies.
 * Register-once, throw-on-duplicate — the `customElements` model (docs/contributing/culture.md
 * "Registries are code, not state"). Leaf layer: id minting delegates to
 * `./command-id`. The dispatchers live here, not `./commands`, so `commands.ts`
 * carries no runtime edge to `command-id`/`block-commands` (else `commands →
 * block-commands → command-id → commands` cycles); `commands.ts` supplies only the
 * global registry and the chord→binding resolvers this file reads.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	mintCommandId,
	__resetMintedCommandIdsForTests,
	type AnyCommandId,
	type PluginCommandId
} from './command-id';
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
import type { EditorContext } from './plugin-install';
import { isReadingMode } from '../presentation-mode';

export interface BlockCommandContext {
	/** Read context — a bytes-readonly view; metadata edits go through `updateMetadata`. */
	node: NodeView;
	arg: unknown;
	updateMetadata(patch: Record<string, unknown>): void;
	/**
	 * The mounted component's view-state hooks, when the dispatching surface owns
	 * an instance — a render-primary plugin casts this to its own hooks type to
	 * drive edit mode, a focus overlay, and the like. `undefined` when the kind is
	 * registered but no component is mounted (a different tier, a cross-block
	 * replay target); a handler must decline gracefully then. The platform never
	 * learns the shape (`unknown` by design).
	 */
	hooks?: unknown;
	/** The dispatching instance's per-plugin EditorContext (document/events/options
	 *  reads). Undefined when the target surface has no instance wiring. Document
	 *  mutation arrives later as further fields here — never a second context object. */
	editor?: EditorContext;
}

export type BlockCommandHandler = (ctx: BlockCommandContext) => boolean;

const blockCommands = new Map<string, BlockCommandHandler>();

const compositeKey = (kind: AnyBlockKind, id: string): string => `${kind} ${id}`;

/**
 * Register-once check precedes the mint: a duplicate `(kind, name)` reports as
 * "register-once", not the mint's own already-minted collision message.
 */
export function registerBlockCommand(
	kind: AnyBlockKind,
	name: string,
	handler: BlockCommandHandler
): PluginCommandId {
	const key = compositeKey(kind, name);
	if (blockCommands.has(key)) {
		throw new Error(
			`registerBlockCommand: (${kind}, ${name}) is already registered — block commands are register-once`
		);
	}
	const id = mintCommandId(name);
	blockCommands.set(key, handler);
	return id;
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
	// The node → metadata-commit bridge (plus optional component hooks) a minted
	// block command resolves against. Supplied by the surfaces that hold the focused
	// node and a commit route — the plugin container factory and the editable-leaf
	// factory. A target that omits it (a built-in leaf/container, the cross-block
	// replay target) resolves no minted command; dispatch falls through to
	// `runCommand`.
	getCommandContext?(): Omit<BlockCommandContext, 'arg'>;
}

/**
 * A contained plugin command failure: the throwing handler's command id plus the
 * raw error. A block command reports its `kind` (its owner resolves by kind
 * lookup); a global command reports its `plugin` directly and carries no kind.
 * The dispatch seam catches the throw and hands this to the caller's sink, which
 * routes it to the editor's error channel (`origin: 'command'`, see
 * `editor-events.ts`). Kept caller-injected so this schema leaf keeps no edge to
 * the editor shell that owns the event surface.
 */
export interface CommandErrorReport {
	kind?: AnyBlockKind;
	command: AnyCommandId;
	plugin?: string;
	error: unknown;
}
export type CommandErrorSink = (report: CommandErrorReport) => void;

/**
 * The one seam both dispatchers route a minted `(kind, id)` command through: read
 * the registry, run the handler against the target's command context, and CONTAIN
 * a handler throw so a plugin bug becomes a reported no-op, never an uncaught
 * error. Containment is unconditional (the safety guarantee lives here, not at the
 * call sites); the sink is optional — an unwired caller still contains, it just
 * doesn't report. Returns `'unresolved'` when no handler is registered or the
 * target supplies no context, so the caller falls through to its own tiers.
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
 * Leaf-path dispatch: the focused editable/chrome surface. Full precedence —
 * global (undo/redo) → minted block command → built-in kind command. Returns true
 * when handled. A minted command resolves only when the target supplies a command
 * context; otherwise it dead-keys (dev-warn) rather than reach a `runCommand` that
 * can't resolve it.
 */
export function dispatchKeyCommand(
	chord: string,
	target: KindCommandTarget,
	ctx: GlobalCommandContext,
	overrides?: KeybindingOverrideMap,
	onCommandError?: CommandErrorSink
): boolean {
	// Reading mode is inert: the whole command vocabulary (edits, undo/redo,
	// reorder) dead-keys at this seam, for every caller at once. Navigation
	// never routes through the keymap, so nothing a reader needs is lost.
	if (isReadingMode(ctx.pluginEditor)) return false;
	const binding = resolveBinding(chord, target.kind, overrides);
	if (!binding) return false;
	const globalRun = getCommand(binding.command);
	// Inject the sink so a plugin-global handler's contained throw reports through
	// the same channel as a block command's — the global tier is the only path that
	// reaches a plugin-global handler.
	if (globalRun) return globalRun({ ...ctx, onCommandError });
	const minted = runMintedCommand(target, binding, onCommandError);
	if (minted !== 'unresolved') return minted;
	if (!isBuiltinCommandId(binding.command)) {
		warnUnresolvedPluginCommand(binding.command);
		return false;
	}
	return target.runCommand(binding.command, binding.arg);
}

/**
 * Container-bubble dispatch. Kind-only — no global tier: undo/redo belong to the
 * focused leaf, and a container bubble re-firing them would double-fire (see
 * `resolveKindBinding` in `./commands`). A minted command resolves through the
 * shared seam when the container supplies a command context; a built-in id falls
 * through to the container's `runCommand`.
 */
export function dispatchKindCommand(
	chord: string,
	target: KindCommandTarget,
	overrides?: KeybindingOverrideMap,
	onCommandError?: CommandErrorSink,
	pluginEditor?: GlobalCommandContext['pluginEditor']
): boolean {
	// Sibling of dispatchKeyCommand's reading-mode gate. This path has no
	// GlobalCommandContext, so the bubble callers pass the lookup directly.
	if (isReadingMode(pluginEditor)) return false;
	const binding = resolveKindBinding(chord, target.kind, overrides);
	if (!binding) return false;
	const minted = runMintedCommand(target, binding, onCommandError);
	if (minted !== 'unresolved') return minted;
	if (!isBuiltinCommandId(binding.command)) {
		warnUnresolvedPluginCommand(binding.command);
		return false;
	}
	return target.runCommand(binding.command, binding.arg);
}
