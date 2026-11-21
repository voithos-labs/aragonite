// @vitest-environment jsdom
// G4.371 over every write route: a plugin holds every top-level block, and after the write each
// one whose node the write kept outside the blocks it changed reads its node's place, while the
// dev check compares every moved read with a fresh walk. A write that names too few blocks fails
// one or the other.
// Miss-analysis: the record's own check reads the runs only where its starts move, so a write
// naming the right count of blocks at the wrong place passed while a held block read a neighbour.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NodeView } from '#lib/core/node-views.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import type { Block } from '#lib/schema/doc-view.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { WRITE_ROUTES, written } from '#lib/test/harness/write-routes.js';
import { takeDevWarnsOf } from '../../support/warn-gate';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const N = 12;

/** How many top-level slots at each end hold the same node before and after. */
function keptEnds(before: readonly NodeView[], after: readonly NodeView[]) {
	const most = Math.min(before.length, after.length);
	let head = 0;
	while (head < most && before[head] === after[head]) head++;
	let tail = 0;
	while (tail < most - head && before.at(-1 - tail) === after.at(-1 - tail)) tail++;
	return { head, tail };
}

describe('G4.371 a held block reads its place after every write route', () => {
	it.each(WRITE_ROUTES)('$name', async (route) => {
		let editor: Editor | undefined;
		const reader = definePluginUnit({
			name: 'unit-reader',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ setup: (e) => void (editor = e) })
		});
		const plugins = [reader, ...((route.plugins ?? []) as [])];
		const m = mountEditor<EditorTestSurface>({ source: route.source(N), plugins });
		await m.settle();
		await route.setUp?.(m, N);
		const tops = [...m.instance.__test.getDocument().children] as NodeView[];
		const held: Block[] = [...editor!.doc.blocks];
		const before = written(m);

		await route.write(m, N);

		expect(written(m), 'the route wrote nothing').not.toEqual(before);
		const after = m.instance.__test.getDocument().children as NodeView[];
		const { head, tail } = keptEnds(tops, after);
		const source = m.source();
		const kept = held.filter((_, i) => i < head || i >= tops.length - tail);
		expect(kept.map((block) => source.slice(block.from, block.to))).toEqual(
			kept.map((block) => block.text)
		);
		void held.map((block) => block.from);
		expect(takeDevWarnsOf('invariant:held-block-place')).toEqual([]);
	});
});
