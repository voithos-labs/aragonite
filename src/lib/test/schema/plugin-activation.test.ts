import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import {
	blockViewFor,
	registerBlockKind,
	registeredKinds
} from '#lib/schema/block-kind-descriptor.js';
import { unfinishedReadings, type BlockOpener } from '#lib/schema/block-openers.js';
import { testClosure } from '#lib/test/harness/closure.js';
import {
	blockContextActionsFor,
	registerBlockContextActions
} from '#lib/schema/context-actions.js';
import type { NodeView } from '#lib/core/node-views.js';
import type { PluginBlockKind } from '#lib/core/nodes.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { testView } from '#lib/test/harness/test-view.js';

const stubView = testView();

const markerOpener = (kind: PluginBlockKind, marker: string): BlockOpener => ({
	priority: 5,
	tryOpen: (ctx) =>
		ctx.line.text.startsWith(marker)
			? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
			: null,
	interruptsParagraph: (t) => t.startsWith(marker)
});

/** A one-kind plugin, installed so `declarePluginKind` records it as the kind's owner. */
function installKindPlugin(name: string, marker: string): PluginBlockKind {
	let kind: PluginBlockKind | undefined;
	installPlugins([
		definePlugin({
			name,
			setup() {
				kind = testLeaf(`${name}-block`, (kind) => ({
					view: stubView,
					opener: markerOpener(kind, marker)
				}));
			}
		})
	]);
	return kind!;
}

describe('kind enablement derived from an instance activation set', () => {
	it('resolves the listed plugin kind and degrades the unlisted one', () => {
		const listed = installKindPlugin('listed', '@a');
		const unlisted = installKindPlugin('unlisted', '@b');

		const view = createEditorGrammar({ plugins: activationFor(['listed']) });
		expect(view.blockView(listed)).toBe(stubView);
		expect(view.blockView(unlisted)).toBeUndefined();
		// Never filtered: the degraded block still needs its descriptor to fall back.
		expect(view.descriptor(unlisted).mergeRole).toBe('not-mergeable');
	});

	it('drops the unlisted plugin opener from the grammar', () => {
		installKindPlugin('listed', '@a');
		installKindPlugin('unlisted', '@b');

		const grammar = createEditorGrammar({ plugins: activationFor(['listed']) });
		expect(parse('@a hi\n', { grammar }).children[0].kind).toBe('listed-block');
		expect(parse('@b hi\n', { grammar }).children[0].kind).toBe('paragraph');
	});

	// Miss-analysis: every interrupt case read the process-wide scan, so none asked an editor that
	// left the plugin out.
	it("ends a paragraph at a listed plugin's line, not at an unlisted one's", () => {
		installKindPlugin('listed', '@a');
		installKindPlugin('unlisted', '@b');

		const grammar = createEditorGrammar({ plugins: activationFor(['listed']) });
		const kinds = (source: string) => parse(source, { grammar }).children.map((c) => c.kind);
		expect(kinds('text\n@a hi\n')).toEqual(['paragraph', 'listed-block']);
		expect(kinds('text\n@b hi\n')).toEqual(['paragraph']);
	});

	it('never gates a kind no plugin owns, built-ins included', () => {
		// Declared outside any install, so the registry records no owner for it.
		const ownerless = testLeaf('ownerless-block');

		const kinds = registeredKinds(activationFor([]));
		expect(kinds).toContain(ownerless);
		expect(kinds).toContain('paragraph');
	});
});

// Miss-analysis: every unfinished-reading case read with the default grammar, so none asked an
// editor that left out a plugin whose line interrupts a paragraph.
describe("a block's reading on the edit route reads the editor's own grammar", () => {
	it("keeps a definition's title across a line only an unlisted plugin interrupts on", () => {
		installKindPlugin('unlisted', '@b');
		const grammar = createEditorGrammar({ plugins: activationFor([]) });
		const raw = '[a]: /url "x\n@b\ny"\n';
		const [definition] = parse(raw, { grammar }).children;
		expect(definition.kind).toBe('linkReferenceDefinition');
		expect(definition.raw).toBe(raw);
		// A definition with its title is final: no line below can change it.
		expect(unfinishedReadings(grammar).some((reading) => reading.notFinal(raw))).toBe(false);
	});
});

// Miss-analysis: no activation test used a failed plugin, and context actions had no activation.
describe('one activation rule for every plugin registration', () => {
	it('shows a plugin context action only in an editor that lists the plugin', () => {
		installPlugins([
			definePlugin({
				name: 'rows',
				setup() {
					registerBlockContextActions('probe-rows', 'rows', () => [
						{ id: 'rows.one', label: 'One', run: () => {} }
					]);
				}
			})
		]);
		const node = { kind: 'probe-rows', raw: 'x\n' } as unknown as NodeView;

		expect(blockContextActionsFor(node, [0], activationFor(['rows']), 'block')).toHaveLength(1);
		expect(blockContextActionsFor(node, [0], activationFor([]), 'block')).toEqual([]);
	});

	it('resolves nothing a plugin registered before its setup threw, in a default editor too', () => {
		let kind: PluginBlockKind | undefined;
		const setupThrows = definePlugin({
			name: 'half',
			setup() {
				kind = declarePluginKind('half-block');
				registerBlockKind(kind, {
					opener: markerOpener(kind, '@h'),
					gapEdges: 'none',
					mergeRole: 'not-mergeable',
					editable: true,
					supportsInline: false,
					closure: testClosure,
					view: stubView
				});
				throw new Error('setup failed halfway');
			}
		});
		expect(() => installPlugins([setupThrows])).toThrow(/setup failed halfway/);

		const view = createEditorGrammar();
		expect(view.blockView(kind!)).toBeUndefined();
		expect(parse('@h hi\n', { grammar: view }).children[0].kind).toBe('paragraph');
		expect(parse('@h hi\n').children[0].kind).toBe('paragraph');
	});
});

describe("a kind's view answers to the plugin that registered the kind", () => {
	it('resolves only in an editor whose plugins list that plugin', () => {
		const listed = installKindPlugin('listed', '@a');
		const unlisted = installKindPlugin('unlisted', '@b');

		const editor = createEditorGrammar({ plugins: activationFor(['listed']) });
		expect(editor.blockView(listed)).toBe(stubView);
		expect(editor.blockView(unlisted)).toBeUndefined();
		expect(blockViewFor(unlisted, activationFor(['unlisted']))).toBe(stubView);
		expect(blockViewFor(unlisted, activationFor(['listed']))).toBeUndefined();
	});
});
