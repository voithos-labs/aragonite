import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { blockViewFor, getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { testView } from '#lib/test/harness/test-view.js';
import type { BlockOpener } from '#lib/schema/block-openers.js';
import { createRegistryView, defaultRegistryView } from '#lib/schema/registry-view.js';
import type { PluginBlockKind } from '#lib/core/nodes.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { activationFor, everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';

const stubView = testView();

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
	const kind = testLeaf('callout-x', (kind) => ({ opener: lineOpener(kind), view: stubView }));
	return kind;
}

// The default view is the global read, which the rest of the unit suite (mounting BlockHost on
// its own) relies on.
describe('defaultRegistryView resolves the global definitions verbatim', () => {
	it('component + descriptor + grammar match the global registry', () => {
		const kind = registerCallout();
		expect(defaultRegistryView.blockView(kind)).toBe(blockViewFor(kind, everyInstalledPlugin));
		expect(defaultRegistryView.descriptor(kind)).toBe(getBlockKindDescriptor(kind));
		expect(parse('@x hi\n', { grammar: defaultRegistryView.grammar }).children[0].kind).toBe(kind);
	});

	it('createRegistryView with no filter returns the default view', () => {
		expect(createRegistryView()).toBe(defaultRegistryView);
		expect(createRegistryView({})).toBe(defaultRegistryView);
	});
});

// Listing no plugin is the bluntest narrowing a host can ask for, so it is where a built-in
// reached by the filter would show.
describe('an editor that lists no plugin', () => {
	it('keeps every built-in opener and drops the plugin one', () => {
		let kind: PluginBlockKind | undefined;
		installPlugins([
			definePlugin({ name: 'callouts', setup: () => void (kind = registerCallout()) })
		]);
		const listsNone = createRegistryView({ plugins: activationFor([]) });
		const builtinOpenerCount = defaultRegistryView.grammar.orderedOpeners().length - 1;
		expect(listsNone.grammar.orderedOpeners().length).toBe(builtinOpenerCount);
		expect(builtinOpenerCount).toBeGreaterThan(0);
		expect(listsNone.blockView(kind!)).toBeUndefined();
	});
});

describe('the syntax switch composes with the plugins an editor lists', () => {
	it('drops an unlisted plugin kind and indented code together', () => {
		installPlugins([definePlugin({ name: 'callouts', setup: () => void registerCallout() })]);
		const view = createRegistryView({
			plugins: activationFor([]),
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
