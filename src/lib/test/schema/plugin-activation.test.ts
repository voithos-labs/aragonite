import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { createRegistryView, kindEnablementFor } from '#lib/schema/registry-view.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { blockViewFor, registerBlockKind } from '#lib/schema/block-kind-descriptor.js';
import type { BlockOpener } from '#lib/schema/block-openers.js';
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

		const view = createRegistryView({ isEnabled: kindEnablementFor(activationFor(['listed'])) });
		expect(view.blockView(listed)).toBe(stubView);
		expect(view.blockView(unlisted)).toBeUndefined();
		// Never filtered: the degraded block still needs its descriptor to fall back.
		expect(view.descriptor(unlisted).mergeRole).toBe('not-mergeable');
	});

	it('drops the unlisted plugin opener from the grammar', () => {
		installKindPlugin('listed', '@a');
		installKindPlugin('unlisted', '@b');

		const grammar = createRegistryView({
			isEnabled: kindEnablementFor(activationFor(['listed']))
		}).grammar;
		expect(parse('@a hi\n', { grammar }).children[0].kind).toBe('listed-block');
		expect(parse('@b hi\n', { grammar }).children[0].kind).toBe('paragraph');
	});

	it('never gates a kind no plugin owns, built-ins included', () => {
		// Declared outside any install, so the registry records no owner for it.
		const ownerless = testLeaf('ownerless-block');

		const isEnabled = kindEnablementFor(activationFor([]));
		expect(isEnabled(ownerless)).toBe(true);
		expect(isEnabled('paragraph')).toBe(true);
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

		const view = createRegistryView();
		expect(view.blockView(kind!)).toBeUndefined();
		expect(parse('@h hi\n', { grammar: view.grammar }).children[0].kind).toBe('paragraph');
		expect(parse('@h hi\n').children[0].kind).toBe('paragraph');
	});
});

describe("a kind's view answers to the plugin that registered the kind", () => {
	it('resolves only in an editor whose plugins list that plugin', () => {
		const listed = installKindPlugin('listed', '@a');
		const unlisted = installKindPlugin('unlisted', '@b');

		const editor = createRegistryView({ plugins: activationFor(['listed']) });
		expect(editor.blockView(listed)).toBe(stubView);
		expect(editor.blockView(unlisted)).toBeUndefined();
		expect(blockViewFor(unlisted, activationFor(['unlisted']))).toBe(stubView);
		expect(blockViewFor(unlisted, activationFor(['listed']))).toBeUndefined();
	});
});
