import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { activationFor } from '$lib/schema/plugin-activation';
import { createRegistryView, kindEnablementFor } from '$lib/schema/registry-view';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import {
	registerBlockComponent,
	getBlockComponent,
	type BlockComponentEntry
} from '$lib/schema/block-component-registry';
import { registerBlockOpener, type BlockOpener } from '$lib/schema/block-openers';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { blockContextActionsFor, registerBlockContextActions } from '$lib/schema/context-actions';
import type { NodeView } from '$lib/core/node-views';
import type { PluginBlockKind } from '$lib/core/nodes';

const stubComponent = {} as BlockComponentEntry;

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
				kind = declarePluginKind(`${name}-block`);
				registerBlockKind(kind, {
					gapEdges: 'none',
					mergeRole: 'not-mergeable',
					editable: true,
					supportsInline: false,
					closure: testClosure
				});
				registerBlockComponent(kind, stubComponent);
				registerBlockOpener(kind, markerOpener(kind, marker));
			}
		})
	]);
	return kind!;
}

afterEach(() => __resetSchemaRegistriesForTests());

describe('kind enablement derived from an instance activation set', () => {
	it('resolves the listed plugin kind and degrades the unlisted one', () => {
		const listed = installKindPlugin('listed', '@a');
		const unlisted = installKindPlugin('unlisted', '@b');

		const view = createRegistryView({ isEnabled: kindEnablementFor(activationFor(['listed'])) });
		expect(view.component(listed)).toBe(stubComponent);
		expect(view.component(unlisted)).toBeUndefined();
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
		const ownerless = declarePluginKind('ownerless-block');
		registerBlockKind(ownerless, {
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure
		});
		registerBlockComponent(ownerless, stubComponent);

		const isEnabled = kindEnablementFor(activationFor([]));
		expect(isEnabled(ownerless)).toBe(true);
		expect(isEnabled('paragraph')).toBe(true);
	});
});

// Miss-analysis: each activation copy was tested against a listed or unlisted plugin, never a
// failed one, and the context-action read had no activation to test at all.
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

		expect(blockContextActionsFor(node, [0], activationFor(['rows']))).toHaveLength(1);
		expect(blockContextActionsFor(node, [0], activationFor([]))).toEqual([]);
	});

	it('resolves nothing a plugin registered before its setup threw, in a default editor too', () => {
		let kind: PluginBlockKind | undefined;
		const setupThrows = definePlugin({
			name: 'half',
			setup() {
				kind = declarePluginKind('half-block');
				registerBlockKind(kind, {
					gapEdges: 'none',
					mergeRole: 'not-mergeable',
					editable: true,
					supportsInline: false,
					closure: testClosure
				});
				registerBlockComponent(kind, stubComponent);
				registerBlockOpener(kind, markerOpener(kind, '@h'));
				throw new Error('setup failed halfway');
			}
		});
		expect(() => installPlugins([setupThrows])).toThrow(/setup failed halfway/);

		const view = createRegistryView();
		expect(view.component(kind!)).toBeUndefined();
		expect(parse('@h hi\n', { grammar: view.grammar }).children[0].kind).toBe('paragraph');
		expect(parse('@h hi\n').children[0].kind).toBe('paragraph');
	});
});

// Miss-analysis: every case registered a kind and its component from the same plugin, so the
// view's kind check and the component registry's own check always agreed, and a component that
// answered to its registering plugin instead went unseen.
describe("a kind's component answers to the plugin that owns the kind", () => {
	it('resolves only where the kind owner is listed, whichever plugin registered the component', () => {
		let kind: PluginBlockKind | undefined;
		installPlugins([
			definePlugin({ name: 'owner', setup: () => void (kind = declarePluginKind('owned-block')) }),
			definePlugin({ name: 'skinner', setup: () => registerBlockComponent(kind!, stubComponent) })
		]);

		expect(getBlockComponent(kind!, activationFor(['skinner']))).toBeUndefined();
		expect(getBlockComponent(kind!, activationFor(['owner']))).toBe(stubComponent);
	});
});
