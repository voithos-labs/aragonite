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
import CodeBlock from '#lib/components/blocks/code/CodeBlock.svelte';
import TableBlock from '#lib/components/blocks/table/TableBlock.svelte';
import { testClosure } from '#lib/test/harness/closure.js';

const fakeComponent = () => {};
const leaf = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
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
