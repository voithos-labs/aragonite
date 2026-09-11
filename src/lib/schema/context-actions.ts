/**
 * The block context menu's vocabulary: what a right-click on a block of a given kind offers.
 * A kind's own providers come first, then the ones registered for every kind (`'*'`: the
 * editor's default Delete). Providers are consulted on every open, so they read the block as it
 * is. Built-in kinds register theirs at bootstrap; a plugin registers through the public barrel.
 */
export const EVERY_KIND = '*';
import type { NodeView } from '../core/node-views';

export interface BlockActionContext {
	node: NodeView;
	/** The block's path from the document root. Top-level blocks only, for now. */
	path: number[];
	/** Remove the block. */
	deleteBlock(): Promise<void>;
	/** Replace the block's bytes wholesale; the result reparses to whatever those bytes are. */
	replaceRaw(raw: string): Promise<void>;
}

export interface BlockContextAction {
	id: string;
	label: string;
	/** A glyph name the menu knows (`components/menu/MenuIcon.svelte`); absent draws none. */
	icon?: string;
	danger?: boolean;
	run(ctx: BlockActionContext): void | Promise<void>;
}

export type BlockContextActionProvider = (node: NodeView, path: number[]) => BlockContextAction[];

const providers = new Map<string, BlockContextActionProvider[]>();

/** Add a provider for `kind`, or for every kind with `EVERY_KIND`. Several may stack. */
export function registerBlockContextActions(
	kind: string,
	provider: BlockContextActionProvider
): void {
	const list = providers.get(kind) ?? [];
	list.push(provider);
	providers.set(kind, list);
}

export function blockContextActionsFor(node: NodeView, path: number[]): BlockContextAction[] {
	const own = providers.get(node.kind) ?? [];
	const every = providers.get(EVERY_KIND) ?? [];
	return [...own, ...every].flatMap((provider) => provider(node, path));
}

/** Test-only. */
export function __resetBlockContextActionsForTests(): void {
	providers.clear();
}
