// @vitest-environment jsdom
// Tab and Shift+Tab move list items between levels and never change the order their text reads in,
// whether a caret or a range presses them.
// Miss-analysis: every indent test pressed one key on a hand-picked list, so nothing pressed a
// sequence that lifts an item with siblings after it, the shape that read them out of order.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import fc from 'fast-check';
import type { Document } from '$lib/core/nodes';
import {
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import { freshOrFixedSeed } from '$lib/test/invariants/arbitraries';

beforeAll(installLayoutStubs);

type Seam = { getDocument(): Document };
let mounted: MountedEditor<Seam> | null = null;
afterEach(async () => {
	await mounted?.destroy();
	mounted = null;
});

const COUNT = 6;
const TEXTS = Array.from({ length: COUNT }, (_, i) => `i${i}`);
const SOURCE = TEXTS.map((text) => `- ${text}\n`).join('');

const arbPress = fc.record({
	from: fc.nat({ max: COUNT - 1 }),
	// Zero presses at a caret; more reaches that many items down as a range.
	span: fc.nat({ max: 3 }),
	shift: fc.boolean()
});

/** The path of the paragraph that holds `text`, wherever the presses so far moved it. */
function pathOf(doc: Document, text: string): number[] {
	let found: number[] | null = null;
	const walk = (nodes: Document['children'], path: number[]) =>
		nodes.forEach((node, i) => {
			if (node.kind === 'paragraph' && node.raw.trim() === text) found = [...path, i];
			if (node.children) walk(node.children, [...path, i]);
		});
	walk(doc.children, []);
	if (!found) throw new Error(`no paragraph reads ${text}`);
	return found;
}

describe('Tab and Shift+Tab keep the order of a list', () => {
	it('any sequence reads the items in their first order', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(arbPress, { minLength: 1, maxLength: 6 }), async (presses) => {
				await mounted?.destroy();
				const editor = mountEditor<Seam>({ source: SOURCE });
				mounted = editor;
				for (const { from, span, shift } of presses) {
					const doc = editor.instance.__test.getDocument();
					const start = pathOf(doc, TEXTS[from]);
					const end = pathOf(doc, TEXTS[Math.min(from + span, COUNT - 1)]);
					// A collapsed pair is a caret, which also ends the range the last press kept.
					const atCaret = end.join() === start.join();
					await editor.instance.setSelection({
						anchor: { path: start, offset: 0 },
						focus: { path: end, offset: atCaret ? 0 : 1 }
					});
					await editor.settle();
					await pressKey(surfaceAt(editor, end), { key: 'Tab', shiftKey: shift });
					expect(editor.source().match(/i\d/g)).toEqual(TEXTS);
				}
			}),
			{ numRuns: 40, seed: freshOrFixedSeed(693) }
		);
	}, 120_000);

	// The property's first shrunk counterexample: a range nests two items, then a caret lifts the
	// first of them while the second still sits after it.
	it('Tab over i0 to i2, then Shift+Tab on i1', async () => {
		const editor = mountEditor<Seam>({ source: SOURCE });
		mounted = editor;
		await editor.instance.setSelection({
			anchor: { path: [0, 0, 0], offset: 0 },
			focus: { path: [0, 2, 0], offset: 1 }
		});
		await editor.settle();
		await pressKey(surfaceAt(editor, [0, 2, 0]), { key: 'Tab' });
		const at = pathOf(editor.instance.__test.getDocument(), 'i1');
		await editor.instance.setSelection({
			anchor: { path: at, offset: 0 },
			focus: { path: at, offset: 0 }
		});
		await editor.settle();
		await pressKey(surfaceAt(editor, at), { key: 'Tab', shiftKey: true });

		expect(editor.source()).toBe('- i0\n- i1\n  - i2\n- i3\n- i4\n- i5\n');
	});
});
