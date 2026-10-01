// A component built on the editable leaf publishes its whole block surface as the one `blockApi`
// export, so a member added to the leaf reaches every such component the day it's added.
// Miss-analysis: a scan required one hand-copied member, so a leaf copying the others partly
// compiled clean and lost whatever it skipped.
import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { defineBlockComponent } from '$lib/schema/block-component-registry';
import { createEditableLeaf, type EditableLeaf } from '$lib/components/blocks/editable-leaf';
import { resolveBlockSurface, type BlockComponent } from '$lib/block-component';
import type { NodeView } from '$lib/core/node-views';

type LeafProps = { node: NodeView; index: number };

// ── Compile-time pins ───────────────────────────────────────────────────────
// Never called: `npm run check` is the gate. An "unused '@ts-expect-error'" error means a leaf
// component can publish less than its whole block surface again.
const typePins = (leaf: EditableLeaf, view: NodeView): void => {
	const silent = null as unknown as Component<LeafProps, Record<never, never>>;
	// @ts-expect-error a component that publishes nothing gives the editor nothing to focus
	defineBlockComponent(silent);

	const published = null as unknown as Component<LeafProps, { readonly blockApi: BlockComponent }>;
	defineBlockComponent(published);

	// @ts-expect-error the block methods sit on `blockApi` only, so a component copies none by hand
	void leaf.focus;
	// @ts-expect-error the source-commit hook too: `blockApi` is its one way out of the leaf
	void leaf.afterSourceCommit;

	// @ts-expect-error a render-primary leaf owns its swap, so it passes both halves of it
	createEditableLeaf({
		getNode: () => view,
		getIndex: () => 0,
		getPath: () => [],
		getEl: () => null,
		mode: 'render-primary',
		isRevealed: () => false
	});
};
void typePins;

describe('the leaf API', () => {
	// The ref slot compares identity, so a wrapper would overwrite the stored surface on every read.
	it("resolves a published blockApi to the leaf's own object", () => {
		const blockApi = { editable: true, focusable: true } as BlockComponent;
		expect(resolveBlockSurface({ blockApi })).toBe(blockApi);
	});
});
