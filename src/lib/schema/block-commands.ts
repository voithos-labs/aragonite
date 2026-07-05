/**
 * The `(kind, id) → handler` block-command registry plus the container-bubble
 * dispatch that resolves a handler by the focused block's kind. A plugin mints a
 * command id here and binds it to a block kind; `dispatchKindCommand` is the one
 * seam every container-bubble keydown routes through (no sibling-path copies).
 * Register-once, throw-on-duplicate — the `customElements` model (docs/culture.md
 * "Registries are code, not state"). Leaf layer: id minting delegates to
 * `./command-id`. Lives here, not `./commands`, to keep `commands.ts` free of a
 * runtime edge to `command-id`/`block-commands` (else `commands → block-commands
 * → command-id → commands` cycles).
 */
import type { AnyBlockKind, CstNode } from '../core/nodes';
import {
	mintCommandId,
	__resetMintedCommandIdsForTests,
	type AnyCommandId,
	type PluginCommandId
} from './command-id';
import { resolveKindBinding, warnUnresolvedPluginCommand, isBuiltinCommandId } from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';

export interface BlockCommandContext {
	node: CstNode;
	arg: unknown;
	updateMetadata(patch: Record<string, unknown>): void;
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

// ── Container-bubble dispatch ───────────────────────────────────────────

export interface KindCommandTarget {
	kind: AnyBlockKind;
	runCommand(id: AnyCommandId, arg?: unknown): boolean;
	// Supplied only by containers hosting plugin block-commands (the plugin
	// container factory). Built-in containers omit it — their registry tier is
	// inert and dispatch falls straight through to `runCommand`.
	getCommandContext?(): { node: CstNode; updateMetadata(patch: Record<string, unknown>): void };
}

/**
 * Resolve a chord against the target kind's keymap and run the command. Kind-only
 * — no global tier: undo/redo belong to the focused leaf, and a container bubble
 * re-firing them would double-fire (see `resolveKindBinding` in `./commands`).
 * A plugin command resolves through the registry when the container supplies a
 * command context; a built-in id falls through to the container's `runCommand`.
 */
export function dispatchKindCommand(
	chord: string,
	target: KindCommandTarget,
	overrides?: KeybindingOverrideMap
): boolean {
	const binding = resolveKindBinding(chord, target.kind, overrides);
	if (!binding) return false;
	const handler = getBlockCommand(target.kind, binding.command);
	const cmdCtx = handler ? target.getCommandContext?.() : undefined;
	if (handler && cmdCtx) return handler({ ...cmdCtx, arg: binding.arg });
	if (!isBuiltinCommandId(binding.command)) {
		warnUnresolvedPluginCommand(binding.command);
		return false;
	}
	return target.runCommand(binding.command, binding.arg);
}
