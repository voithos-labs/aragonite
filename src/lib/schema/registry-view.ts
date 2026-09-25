/**
 * Per-editor resolution over the process-wide definitions
 * (docs/design/plugin-contract.md § Per-instance enablement). The default view resolves what
 * every installed plugin registered, the same grammar a `parse()` with no editor reads. A view
 * with `plugins` leaves out what an unlisted plugin registered, and `syntax` drops the built-in
 * syntaxes a host switched off; the descriptor is never filtered, since a disabled kind needs it.
 */
import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import { getBlockComponent, type BlockComponentEntry } from './block-component-registry';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor
} from './block-kind-descriptor';
import { defaultGrammarView, createGrammarView, type GrammarView } from './block-openers';
import { everyInstalledPlugin, resolvesIn, type PluginActivation } from './plugin-activation';
import { pluginKindOwner } from './plugin-kind';

/** `false` disables a plugin kind for one editor; built-ins are switched only by `syntax`. */
export type KindEnablement = (kind: AnyBlockKind) => boolean;

/** GFM syntaxes a host can switch off for one editor (the `syntax` prop); each is on by default. */
export interface SyntaxOptions {
	/** A line indented four columns (or by a tab) opens a code block. */
	indentedCode?: boolean;
	/** A `===` or `---` line under paragraph text makes it a heading. */
	setextHeading?: boolean;
}

export interface RegistryView {
	/** The kind's component, or `undefined` when it is unregistered or disabled for this editor. */
	component(kind: AnyBlockKind): BlockComponentEntry | undefined;
	/** The kind's descriptor, never filtered because every kind needs one; throws when absent. */
	descriptor(kind: AnyBlockKind): BlockKindDescriptor;
	tryDescriptor(kind: AnyBlockKind): BlockKindDescriptor | undefined;
	/** The block grammar this editor parses through (`parse(source, { grammar })`). */
	grammar: GrammarView;
}

/**
 * A kind whose plugin this editor did not activate, or whose setup threw, resolves no component
 * and drops its opener. A kind no plugin owns is never filtered, which covers the built-ins and
 * any kind registered outside a plugin install.
 */
export function kindEnablementFor(activation: PluginActivation): KindEnablement {
	return (kind) => resolvesIn(activation, pluginKindOwner(kind));
}

export function createRegistryView(opts?: {
	/** The plugins this editor lists; absent activates every installed plugin. */
	plugins?: PluginActivation;
	/** A further kind filter, narrowing what `plugins` allows. */
	isEnabled?: KindEnablement;
	syntax?: SyntaxOptions;
}): RegistryView {
	const plugins = opts?.plugins;
	const indentedCode = opts?.syntax?.indentedCode ?? true;
	const setextHeading = opts?.syntax?.setextHeading ?? true;
	if (!plugins && !opts?.isEnabled && indentedCode && setextHeading) return defaultRegistryView;
	const activation = plugins ?? everyInstalledPlugin;
	const resolves = kindEnablementFor(activation);
	const narrowed = opts?.isEnabled;
	const enabled: KindEnablement = (kind) =>
		isBuiltinBlockKind(kind) || (resolves(kind) && (!narrowed || narrowed(kind)));
	// A switched-off syntax leaves the grammar only: a block of that kind still renders.
	const opens: KindEnablement = (kind) =>
		enabled(kind) && (indentedCode || kind !== 'indentedCode');
	return {
		component: (kind) => (enabled(kind) ? getBlockComponent(kind, activation) : undefined),
		descriptor: (kind) => getBlockKindDescriptor(kind),
		tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind),
		grammar: createGrammarView(opens, { setextHeading, activation })
	};
}

const everyInstalledKind = kindEnablementFor(everyInstalledPlugin);

export const defaultRegistryView: RegistryView = {
	component: (kind) =>
		everyInstalledKind(kind) ? getBlockComponent(kind, everyInstalledPlugin) : undefined,
	descriptor: (kind) => getBlockKindDescriptor(kind),
	tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind),
	grammar: defaultGrammarView
};
