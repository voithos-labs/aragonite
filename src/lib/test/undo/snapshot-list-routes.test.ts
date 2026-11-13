// @vitest-environment jsdom
// An undo entry is pushed from the version's plain list, which a reader earlier in the version may
// have made. After a write whose own push read that list, every route's entry still holds the
// nodes the tree held at its push, and no push is made from a list the tree has changed since.
// Miss-analysis: every push spread the tree's own list, so no test had to ask whether a list read
// earlier was still the tree's when a snapshot took it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createKeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import { parse } from '#lib/core/parser.js';
import { topsOf } from '#lib/tree-operations/top-level-starts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { WRITE_ROUTES } from '#lib/test/harness/write-routes.js';
import { allowDevWarns, takeDevWarns } from '../support/warn-gate';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const N = 12;

describe('an undo entry is pushed from the list the tree holds', () => {
	it.each(WRITE_ROUTES)('$name', async (route) => {
		const m = mountEditor<EditorTestSurface>({ source: route.source(N) });
		await m.settle();
		// A letter elsewhere first: its push reads the list, and its write copies the block.
		const first = surfaceAt(m, [0]);
		typeInto(first, first.textContent + 'x');
		await m.settle();
		const held = [...m.instance.__test.getDocument().children];
		const depth = m.instance.__test.getUndoStack().undo.length;

		await route.setUp?.(m, N);
		await route.write(m, N);

		const pushed = m.instance.__test.getUndoStack().undo[depth];
		// An undo takes its entry off the stack again, and a swap clears it.
		if (pushed)
			expect(pushed.snapshot.children.map((node, i) => node === held[i])).not.toContain(false);
		expect(takeDevWarns()).toEqual([]);
	});
});

describe('the list a reader made ends where a write may have left copies', () => {
	const SOURCE = Array.from({ length: N }, (_, i) => `line ${i}\n`).join('\n');
	const snapshot = { path: docPathFrom([2]), offset: 0 };

	it('a window that announces nothing ends the pair read before it', () => {
		const starts = createKeptStarts(
			() => parse(SOURCE),
			() => {}
		);
		const before = starts.read();
		starts.duringWrite(() => ({ touched: 'unchanged' }));
		expect(starts.read()).not.toBe(before);
	});

	// A keystroke copies the path it will write before its window opens. One refused after that
	// copy announces nothing, and the next push must not take the list read before it.
	it('a keystroke refused after it copied its block', async () => {
		const h = makeTopHarness(SOURCE);
		const write = (raw: string) =>
			h.controller.commitStructural({
				snapshot,
				mutate(_, scope) {
					scope.own([5])[0].raw = raw;
					return { op: 'noop' };
				},
				op: { kind: 'input', eventPath: docPathFrom([5]) }
			});
		await write('a push, so every block is shared\n');
		const read = topsOf(h.deps.bytes.measured());
		// No block lies at this path below the paragraph, so the write stops after its copy.
		const typed = h.controller.typeLeaf(
			docPathFrom([2, 0]),
			{ text: 'x\n', storedOffset: (offset: number) => offset } as never,
			0
		);
		expect(typed.wrote).toBe(false);
		allowDevWarns(['invariant:unshare-path-in-range', 'invariant:unshared-spine-depth']);
		expect(h.deps.doc.children[2], 'the refused keystroke copied nothing').not.toBe(read[2]);

		await write('the next push\n');

		expect(takeDevWarns()).toEqual([]);
	});
});
