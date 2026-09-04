/**
 * Per-instance resolution over the process-global block definitions (docs/design/plugin-contract.md
 * § Schema registries). The default view resolves every kind VERBATIM, so an editorless `parse()`
 * and every bare component mount stay byte-identical. An `isEnabled` view resolves no component
 * for a disabled plugin kind and drops its opener; the DESCRIPTOR is never filtered, since a
 * disabled kind still needs it to degrade rather than throw. The `plugins` prop sources the
 * predicate: `plugin-activation.ts` turns an instance's listed set into one.
 */
import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import { getBlockComponent, type BlockComponentEntry } from './block-component-registry';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor
} from './block-kind-descriptor';
import { defaultGrammarView, createGrammarView, type GrammarView } from './block-openers';

/** `false` disables a PLUGIN kind for one instance; built-ins are never disableable. */
export type KindEnablement = (kind: AnyBlockKind) => boolean;

export interface RegistryView {
	/** The kind's component, or `undefined` when unregistered OR disabled for this instance. */
	component(kind: AnyBlockKind): BlockComponentEntry | undefined;
	/** The kind's descriptor — never filtered (required infrastructure); throws when absent. */
	descriptor(kind: AnyBlockKind): BlockKindDescriptor;
	tryDescriptor(kind: AnyBlockKind): BlockKindDescriptor | undefined;
	/** The block grammar this instance parses through (`parse(source, { grammar })`). */
	grammar: GrammarView;
}

/** Both predicates must admit the kind, so a second filter can only narrow the first.
 *  An absent side admits everything. */
export function bothEnable(
	a: KindEnablement | undefined,
	b: KindEnablement | undefined
): KindEnablement | undefined {
	if (!a) return b;
	if (!b) return a;
	return (kind) => a(kind) && b(kind);
}

export function createRegistryView(opts?: { isEnabled?: KindEnablement }): RegistryView {
	const filter = opts?.isEnabled;
	if (!filter) return defaultRegistryView;
	const enabled: KindEnablement = (kind) => isBuiltinBlockKind(kind) || filter(kind);
	return {
		component: (kind) => (enabled(kind) ? getBlockComponent(kind) : undefined),
		descriptor: (kind) => getBlockKindDescriptor(kind),
		tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind),
		grammar: createGrammarView(enabled)
	};
}

export const defaultRegistryView: RegistryView = {
	component: (kind) => getBlockComponent(kind),
	descriptor: (kind) => getBlockKindDescriptor(kind),
	tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind),
	grammar: defaultGrammarView
};
