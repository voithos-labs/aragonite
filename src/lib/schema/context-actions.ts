/**
 * What a right-click on a block of a given kind offers. A kind's own providers come first, then
 * the ones registered for every kind (`'*'`: the editor's copy, replace and remove rows).
 * Providers run on every open, so they see the block as it is. The defaults register at startup;
 * a plugin registers through the public barrel.
 */
export const EVERY_KIND = '*';
import type { NodeView } from '../core/node-views';
import type { LineEnding } from '../core/lines';
import type { PluginActivation } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';
import { registerAsCore } from './plugin-install';

export interface BlockActionContext {
	node: NodeView;
	/** The block's path from the document root. Top-level blocks only, for now. */
	path: number[];
	/** Remove the block. */
	deleteBlock(): Promise<void>;
	/** Replace the block's bytes wholesale; the result reparses to whatever those bytes are. */
	replaceRaw(raw: string): Promise<void>;
	/** The document's line ending, which a line in `replaceRaw`'s bytes takes. */
	lineEnding: LineEnding;
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

// Filled by `registerBuiltinBlockContextActions`, whose providers survive the test reset.
const builtinKeys = new Set<string>();

const providers = createPluginRegistry<
	string,
	{ kind: string; provider: BlockContextActionProvider }
>({ label: 'registerBlockContextActions', isBuiltin: (key) => builtinKeys.has(key) });

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

/** The editor's own rows: a provider the test reset keeps, owned by no plugin even when a
 *  plugin's setup is what first reaches it. */
export function registerBuiltinBlockContextActions(
	kind: string,
	name: string,
	provider: BlockContextActionProvider
): void {
	builtinKeys.add(`${kind} ${name}`);
	registerAsCore(() => registerBlockContextActions(kind, name, provider));
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
