import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import {
	registerBlockComponent,
	getBlockComponent,
	type BlockComponentEntry
} from '$lib/schema/block-component-registry';
import { registerBlockOpener, type BlockOpener } from '$lib/schema/block-openers';
import { createRegistryView, defaultRegistryView } from '$lib/schema/registry-view';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import type { AnyBlockKind, PluginBlockKind } from '$lib/core/nodes';
import { testLeaf } from '$lib/test/harness/test-kinds';
import { activationFor, everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';

const stubComponent = {} as BlockComponentEntry;

// An opener that takes a single `@x`-prefixed line as this kind, with byte-exact raw so the
// parser's dev-mode opener check passes.
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
	const kind = testLeaf('callout-x');
	registerBlockComponent(kind, stubComponent);
	registerBlockOpener(kind, lineOpener(kind));
	return kind;
}

afterEach(() => __resetSchemaRegistriesForTests());

// The default view is the global read, the guarantee that behavior is unchanged which the rest
// of the unit suite (mounting BlockHost on its own) relies on.
describe('defaultRegistryView resolves the global definitions verbatim', () => {
	it('component + descriptor + grammar match the global registry', () => {
		const kind = registerCallout();
		expect(defaultRegistryView.component(kind)).toBe(getBlockComponent(kind, everyInstalledPlugin));
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

	it('the descriptor is never filtered: a disabled kind still degrades, not throws', () => {
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

	it('built-ins are never disableable: the predicate domain is plugin kinds', () => {
		const disableEverything = createRegistryView({ isEnabled: () => false });
		// A blanket "disable all" must drop only the plugin opener: a built-in losing its opener
		// here would mean the predicate reached past plugin kinds.
		const builtinOpenerCount = defaultRegistryView.grammar.orderedOpeners().length - 1;
		expect(disableEverything.grammar.orderedOpeners().length).toBe(builtinOpenerCount);
		expect(builtinOpenerCount).toBeGreaterThan(0);
		// The plugin kind itself is disabled by the same predicate.
		expect(disableEverything.component(kind)).toBeUndefined();
	});
});

// The second filter is the test harness's, layered over the editor's own activation, so it may
// only narrow: one that widened would allow a resolution the shipped path cannot reach.
describe('a kind filter layered over the activation', () => {
	it('narrows what the activation allows and never widens it', () => {
		let kind: PluginBlockKind | undefined;
		installPlugins([
			definePlugin({ name: 'callouts', setup: () => void (kind = registerCallout()) })
		]);

		const unlisted = createRegistryView({ plugins: activationFor([]), isEnabled: () => true });
		expect(unlisted.component(kind!)).toBeUndefined();
		const narrowed = createRegistryView({
			plugins: activationFor(['callouts']),
			isEnabled: () => false
		});
		expect(narrowed.component(kind!)).toBeUndefined();
		expect(createRegistryView({ plugins: activationFor(['callouts']) }).component(kind!)).toBe(
			stubComponent
		);
	});
});

describe('the syntax switch composes with the plugin filter', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('drops the plugin kind the filter leaves out and indented code together', () => {
		const kind = registerCallout();
		const view = createRegistryView({
			isEnabled: (k) => k !== kind,
			syntax: { indentedCode: false }
		});
		const doc = parse('@x one\n\n\tnotes\n', { grammar: view.grammar });
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
	});

	it('a view with every syntax on and no filter is the default view', () => {
		expect(createRegistryView({ syntax: { indentedCode: true, setextHeading: true } })).toBe(
			defaultRegistryView
		);
	});
});
