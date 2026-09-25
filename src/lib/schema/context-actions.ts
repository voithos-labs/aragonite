/**
 * What a right-click on a block of a given kind offers. A kind's own providers come first, then
 * the ones registered for every kind (`'*'`: the editor's copy, replace and remove rows).
 * Providers run on every open, so they see the block as it is. The defaults register at startup;
 * a plugin registers through the public barrel.
 */
export const EVERY_KIND = '*';
import type { NodeView } from '../core/node-views';
import type { PluginActivation } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';

export interface BlockActionContext {
	node: NodeView;
	/** The block's path from the document root. Top-level blocks only, for now. */
	path: number[];
	/** Remove the block. */
	deleteBlock(): Promise<void>;
	/** Replace the block's bytes wholesale; the result reparses to whatever those bytes are. */
	replaceRaw(raw: string): Promise<void>;
	/** Pasted text through the paste transforms of the plugins this editor lists, as a paste
	 *  into the editor would see it. */
	transformPaste(text: string): string;
}

export interface BlockContextAction {
	id: string;
	label: string;
	/** An icon name the menu knows (`src/lib/menu-icons.ts`); absent draws none. */
	icon?: string;
	danger?: boolean;
	run(ctx: BlockActionContext): void | Promise<void>;
}

export type BlockContextActionProvider = (node: NodeView, path: number[]) => BlockContextAction[];

// The editor's own providers, registered by `components/menu/default-context-actions.ts` and
// `components/blocks/code/code-context-actions.ts`; they survive the test reset.
const BUILT_IN_PROVIDERS: ReadonlySet<string> = new Set(['* block', 'fencedCode code']);

const providers = createPluginRegistry<
	string,
	{ kind: string; provider: BlockContextActionProvider }
>({ label: 'registerBlockContextActions', isBuiltin: (key) => BUILT_IN_PROVIDERS.has(key) });

/**
 * Add a provider for `kind`, or for every kind with `EVERY_KIND`, under a `name` unique to that
 * kind. Throws when the name is taken for the kind. A plugin's rows show only in the editors that
 * list the plugin.
 */
export function registerBlockContextActions(
	kind: string,
	name: string,
	provider: BlockContextActionProvider
): void {
	providers.register(
		`${kind} ${name}`,
		{ kind, provider },
		`registerBlockContextActions: "${name}" is already registered for "${kind}". Providers are register-once.`
	);
}

export function blockContextActionsFor(
	node: NodeView,
	path: number[],
	activation: PluginActivation
): BlockContextAction[] {
	const active = providers.entries(activation).map(([, entry]) => entry);
	return [
		...active.filter((entry) => entry.kind === node.kind),
		...active.filter((entry) => entry.kind === EVERY_KIND)
	].flatMap(({ provider }) => provider(node, path));
}
