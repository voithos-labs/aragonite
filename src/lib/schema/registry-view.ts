/**
 * Per-instance resolution over the process-global block definitions.
 *
 * Kind definitions stay global (the `customElements` model — register-once, one
 * definition per process; docs/design/plugin-contract.md § Schema registries). An
 * editor instance reads them through a `RegistryView` whose default resolves every
 * kind VERBATIM — the module-level registry functions ARE the default view — so an
 * editorless `parse()` pipeline and every bare component mount stay byte-identical.
 *
 * Enablement is the additive policy layer the frozen contract pre-authorizes: a
 * view built with an `isEnabled` predicate resolves NO component for a disabled
 * plugin kind (BlockHost's raw-editable fallback renders it — the unknown-kind
 * rule) and drops its opener from the grammar. Built-ins are never disableable —
 * the predicate's domain is plugin kinds. The DESCRIPTOR is never filtered: it is
 * required infrastructure (isContainer, merge role, rebuild), and a disabled kind
 * still needs it to degrade rather than throw.
 */
// TODO(limestone): public enablement prop — the predicate that sources enablement
// has no public door yet; it firms up with limestone (docs/design/plugin-contract.md).
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
