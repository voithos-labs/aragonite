/**
 * A block kind's view travels in its registration: a plugin kind can't register without one, and
 * a built-in's view, attached later from the component layer, survives the augments that follow.
 * Miss: the view refusal covered widgets and menu rows only, so a block plugin passing `component`
 * registered silently and drew raw.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import {
	blockViewFor,
	registerBlockKind,
	type BlockKindRegistration
} from '#lib/schema/block-kind-descriptor.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { registerBuiltInBlocks } from '#lib/components/built-in-blocks.js';
import { blockViewEntry } from '#lib/components/block-view-entry.js';
import { defineBlockView } from '#lib/components/dom-block-view/define-block-view.js';
import type { BlockViewSpec } from '#lib/schema/block-view.js';
import CodeBlock from '#lib/components/blocks/code/CodeBlock.svelte';
import TableBlock from '#lib/components/blocks/table/TableBlock.svelte';

const fakeComponent = () => {};
const leaf = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false
} as const;

describe('registerBlockKind refuses a kind with no view', () => {
	it.each([
		['nothing', undefined],
		['a bare component', fakeComponent],
		['the replaced entry object', { component: fakeComponent }]
	])('refuses %s with the helpers to use', (_shape, view) => {
		const kind = declarePluginKind('legacy-block');
		expect(() =>
			registerBlockKind(kind, { ...leaf, view } as unknown as BlockKindRegistration)
		).toThrow(
			/"legacy-block" needs a `view`.*`defineBlockView\(spec\)`.*`textBlockView\(\)` from `[^`]*\/plugin`.*svelteBlockView/
		);
		expect(blockViewFor(kind, everyInstalledPlugin)).toBeUndefined();
	});
});

// The two kinds `registerBuiltInBlocks` augments after attaching the views.
describe('a built-in keeps its view through the augments that follow it', () => {
	beforeAll(registerBuiltInBlocks);

	it.each([
		['fencedCode', CodeBlock],
		['table', TableBlock]
	] as const)('%s still draws through its own component', (kind, component) => {
		const view = blockViewFor(kind, everyInstalledPlugin);
		expect(view && blockViewEntry(view).component).toBe(component);
	});
});

// Miss-analysis: these refusals' rows sat in the hand-built surface's file and went with it,
// though a DOM view still draws containers only.
describe('a DOM view draws a container kind only', () => {
	it('is refused on a kind with no container group', () => {
		const kind = declarePluginKind('dom-view-on-a-leaf');
		const view = defineBlockView({ surface: 'container', mount: () => ({}) });
		expect(() => registerBlockKind(kind, { ...leaf, view })).toThrow(
			/"dom-view-on-a-leaf" has no container group, but `defineBlockView` draws a container kind/
		);
	});

	it.each([
		['an unknown surface', { surface: 'popover', mount: () => ({}) }],
		['the hand-built surface, gone', { surface: 'none', mount: () => ({}) }],
		['no surface', { mount: () => ({}) }],
		['a mount that is not a function', { surface: 'container', mount: 'draw' }]
	])('defineBlockView refuses %s', (_name, spec) => {
		expect(() => defineBlockView(spec as unknown as BlockViewSpec)).toThrow(/defineBlockView/);
	});
});
