/**
 * Per-editor resolution over the process-wide block definitions
 * (docs/design/plugin-contract.md § The registries: global, register-once). The default view
 * resolves every kind exactly as registered, so a `parse()` with no editor and every plain
 * component mount stay byte-identical. A view with `isEnabled` resolves no component for a
 * disabled plugin kind and drops its opener, and `syntax` drops the built-in syntaxes a host
 * switched off; the descriptor is never filtered, since a disabled kind still needs it.
 */
import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import { getBlockComponent, type BlockComponentEntry } from './block-component-registry';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor
} from './block-kind-descriptor';
import { defaultGrammarView, createGrammarView, type GrammarView } from './block-openers';

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

/** Both predicates must allow the kind, so a second filter can only narrow the first.
 *  A missing predicate allows everything. */
export function bothEnable(
	a: KindEnablement | undefined,
	b: KindEnablement | undefined
): KindEnablement | undefined {
	if (!a) return b;
	if (!b) return a;
	return (kind) => a(kind) && b(kind);
}

export function createRegistryView(opts?: {
	isEnabled?: KindEnablement;
	syntax?: SyntaxOptions;
}): RegistryView {
	const filter = opts?.isEnabled;
	const indentedCode = opts?.syntax?.indentedCode ?? true;
	const setextHeadings = opts?.syntax?.setextHeading ?? true;
	if (!filter && indentedCode && setextHeadings) return defaultRegistryView;
	const enabled: KindEnablement = (kind) => isBuiltinBlockKind(kind) || !filter || filter(kind);
	// A switched-off syntax leaves the grammar only: a block of that kind still renders.
	const opens: KindEnablement = (kind) =>
		enabled(kind) && (indentedCode || kind !== 'indentedCode');
	return {
		component: (kind) => (enabled(kind) ? getBlockComponent(kind) : undefined),
		descriptor: (kind) => getBlockKindDescriptor(kind),
		tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind),
		grammar: createGrammarView(opens, { setextHeadings })
	};
}

export const defaultRegistryView: RegistryView = {
	component: (kind) => getBlockComponent(kind),
	descriptor: (kind) => getBlockKindDescriptor(kind),
	tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind),
	grammar: defaultGrammarView
};
