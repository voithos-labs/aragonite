/**
 * The `(kind, id) → handler` block-command registry. A plugin mints a command
 * id here and binds it to a block kind; dispatch (later tasks) resolves the
 * handler by the focused block's kind. Register-once, throw-on-duplicate — the
 * `customElements` model (docs/culture.md "Registries are code, not state").
 * Leaf layer: id minting delegates to `./command-id`.
 */
import type { AnyBlockKind, CstNode } from '../core/nodes';
import {
	mintCommandId,
	__resetMintedCommandIdsForTests,
	type AnyCommandId,
	type PluginCommandId
} from './command-id';

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
