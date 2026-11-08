import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { blockViewFor, getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { testView } from '#lib/test/harness/test-view.js';
import type { BlockOpener } from '#lib/schema/block-openers.js';
import { createEditorGrammar, defaultGrammarView } from '#lib/schema/editor-grammar.js';
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

// The default grammar is the global read, which the rest of the unit suite (mounting BlockHost on
// its own) relies on.
describe('defaultGrammarView resolves every installed definition', () => {
	it('component + descriptor + grammar match the global registry', () => {
		const kind = registerCallout();
		expect(defaultGrammarView.blockView(kind)).toBe(blockViewFor(kind, everyInstalledPlugin));
		expect(defaultGrammarView.descriptor(kind)).toBe(getBlockKindDescriptor(kind));
		expect(parse('@x hi\n', { grammar: defaultGrammarView }).children[0].kind).toBe(kind);
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
		const listsNone = createEditorGrammar({ plugins: activationFor([]) });
		const builtinOpenerCount = defaultGrammarView.orderedOpeners().length - 1;
		expect(listsNone.orderedOpeners().length).toBe(builtinOpenerCount);
		expect(builtinOpenerCount).toBeGreaterThan(0);
		expect(listsNone.blockView(kind!)).toBeUndefined();
		expect(listsNone.interruptsParagraph('@x hi')).toBe(false);
		expect(defaultGrammarView.interruptsParagraph('@x hi')).toBe(true);
	});
});

describe('the syntax switch composes with the plugins an editor lists', () => {
	it('drops an unlisted plugin kind and indented code together', () => {
		installPlugins([definePlugin({ name: 'callouts', setup: () => void registerCallout() })]);
		const grammar = createEditorGrammar({
			plugins: activationFor([]),
			syntax: { indentedCode: false }
		});
		const doc = parse('@x one\n\n\tnotes\n', { grammar });
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
	});
});
