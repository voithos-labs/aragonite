import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { activationFor, kindEnablementFor } from '$lib/schema/plugin-activation';
import { createRegistryView } from '$lib/schema/registry-view';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import {
	registerBlockComponent,
	type BlockComponentEntry
} from '$lib/schema/block-component-registry';
import { registerBlockOpener, type BlockOpener } from '$lib/schema/block-openers';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import type { PluginBlockKind } from '$lib/core/nodes';
import { testLeaf } from '$lib/test/harness/test-kinds';

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
				kind = testLeaf(`${name}-block`);
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
		const ownerless = testLeaf('ownerless-block');
		registerBlockComponent(ownerless, stubComponent);

		const isEnabled = kindEnablementFor(activationFor([]));
		expect(isEnabled(ownerless)).toBe(true);
		expect(isEnabled('paragraph')).toBe(true);
	});
});
