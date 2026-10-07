// The editable leaf hands its block methods over only as `blockApi`, a render-primary leaf owns its
// swap, and the editor reads a published `blockApi` as the block. The component's export is G4.73's.
// Miss-analysis: a scan required one hand-copied member, so a leaf copying the others partly
// compiled clean and lost whatever it skipped.
import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { defineBlockComponent } from '#lib/schema/block-component-registry.js';
import {
	createEditableLeaf,
	type EditableLeaf,
	type EditableLeafDeps
} from '#lib/components/blocks/editable-leaf.js';
import { resolveBlockSurface, type EditableLeafBlockApi } from '#lib/block-component.js';
import type { NodeView } from '#lib/core/node-views.js';

type LeafProps = { node: NodeView; index: number };

// ── Compile-time pins ───────────────────────────────────────────────────────
// Never called: `npm run check` is the gate. An "unused '@ts-expect-error'" error means the leaf
// has block methods at its top level again, or the deps union stopped requiring the swap.
const typePins = (leaf: EditableLeaf, view: NodeView): void => {
	const silent = null as unknown as Component<LeafProps, Record<never, never>>;
	// @ts-expect-error a component that publishes nothing gives the editor nothing to focus
	defineBlockComponent(silent);

	const published = null as unknown as Component<
		LeafProps,
		{ readonly blockApi: EditableLeafBlockApi }
	>;
	defineBlockComponent(published);

	type HandBuilt = Pick<
		EditableLeafBlockApi,
		'editable' | 'focusable' | 'focus' | 'getCursorOffset'
	>;
	const handBuilt = null as unknown as Component<LeafProps, { readonly blockApi: HandBuilt }>;
	// @ts-expect-error a hand-built object under the name drops what it skipped
	defineBlockComponent(handBuilt);
	type WrittenOver = Omit<EditableLeafBlockApi, 'afterSourceCommit'> & {
		afterSourceCommit: undefined;
	};
	const writtenOver = null as unknown as Component<LeafProps, { readonly blockApi: WrittenOver }>;
	// @ts-expect-error so does the leaf's object with a member written over
	defineBlockComponent(writtenOver);

	// @ts-expect-error the block methods sit on `blockApi` only
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
		const blockApi = { editable: true, focusable: true } as EditableLeafBlockApi;
		expect(resolveBlockSurface({ blockApi })).toBe(blockApi);
	});

	// A cast stands in for a JavaScript plugin, which never meets the deps union.
	it('refuses a render-primary leaf without its swap when it is built', () => {
		const deps = {
			getNode: () => ({}) as NodeView,
			getIndex: () => 0,
			getPath: () => [],
			getEl: () => null,
			mode: 'render-primary',
			isRevealed: () => false
		} as unknown as EditableLeafDeps;
		expect(() => createEditableLeaf(deps)).toThrow(/render-primary.*setRevealed/);
	});
});
