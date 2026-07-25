import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import {
	registerBlockComponent,
	getBlockComponent,
	type BlockComponentEntry
} from '$lib/schema/block-component-registry';
import { registerBlockOpener, type BlockOpener } from '$lib/schema/block-openers';
import { createRegistryView, defaultRegistryView } from '$lib/schema/registry-view';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { AnyBlockKind, PluginBlockKind } from '$lib/core/nodes';

const stubComponent = {} as BlockComponentEntry;

// An opener that claims a single `@x`-prefixed line as this kind — byte-exact raw
// so the parser's DEV opener guard passes.
const lineOpener = (kind: PluginBlockKind): BlockOpener => ({
	priority: 5,
	tryOpen: (ctx) =>
		ctx.line.text.startsWith('@x')
			? {
					node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
					consumed: 1
				}
			: null,
	interruptsParagraph: (t) => t.startsWith('@x')
});

function registerCallout(): PluginBlockKind {
	const kind = declarePluginKind('callout-x');
	registerBlockKind(kind, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure
	});
	registerBlockComponent(kind, stubComponent);
	registerBlockOpener(kind, lineOpener(kind));
	return kind;
}

afterEach(() => __resetSchemaRegistriesForTests());

// The default view IS the global read — the behavior-preserving guarantee that the
// full unit suite (mounting BlockHost bare) relies on.
describe('defaultRegistryView resolves the global definitions verbatim', () => {
	it('component + descriptor + grammar match the global registry', () => {
		const kind = registerCallout();
		expect(defaultRegistryView.component(kind)).toBe(getBlockComponent(kind));
		expect(defaultRegistryView.descriptor(kind)).toBe(getBlockKindDescriptor(kind));
		expect(parse('@x hi\n', { grammar: defaultRegistryView.grammar }).children[0].kind).toBe(kind);
	});

	it('createRegistryView with no filter returns the default view', () => {
		expect(createRegistryView()).toBe(defaultRegistryView);
		expect(createRegistryView({})).toBe(defaultRegistryView);
	});
});

describe('enablement filter', () => {
	let kind: AnyBlockKind;
	beforeEach(() => {
		kind = registerCallout();
	});

	it('a disabled plugin kind resolves no component (raw-editable fallback)', () => {
		const view = createRegistryView({ isEnabled: (k) => k !== kind });
		expect(view.component(kind)).toBeUndefined();
	});

	it('the descriptor is never filtered — a disabled kind still degrades, not throws', () => {
		const view = createRegistryView({ isEnabled: (k) => k !== kind });
		expect(view.descriptor(kind)).toBe(getBlockKindDescriptor(kind));
	});

	it('a disabled kind opener is dropped from the grammar and parse', () => {
		const disabled = createRegistryView({ isEnabled: (k) => k !== kind });
		// Only the plugin opener is dropped; the built-ins (which survive the reset)
		// stay, so the disabled grammar is exactly one opener short of the default.
		expect(disabled.grammar.orderedOpeners().length).toBe(
			defaultRegistryView.grammar.orderedOpeners().length - 1
		);
		expect(parse('@x hi\n', { grammar: disabled.grammar }).children[0].kind).toBe('paragraph');

		const enabled = createRegistryView({ isEnabled: () => true });
		expect(parse('@x hi\n', { grammar: enabled.grammar }).children[0].kind).toBe(kind);
	});

	it('built-ins are never disableable — the predicate domain is plugin kinds', () => {
		const disableEverything = createRegistryView({ isEnabled: () => false });
		// Every built-in opener survives; only the one plugin opener is dropped, so a
		// blanket "disable all" cannot strip the grammar down to the built-ins losing
		// their openers.
		const builtinOpenerCount = defaultRegistryView.grammar.orderedOpeners().length - 1;
		expect(disableEverything.grammar.orderedOpeners().length).toBe(builtinOpenerCount);
		expect(builtinOpenerCount).toBeGreaterThan(0);
		// The plugin kind IS disabled by the same predicate.
		expect(disableEverything.component(kind)).toBeUndefined();
	});
});
