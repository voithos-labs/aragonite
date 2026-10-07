// A whole-block delete puts the caret down once, on the side the key points, whichever route asked.
// Miss-analysis: each delete route was tested for its bytes, never for how many carets it placed
// or where, so a second placement after the delete and a key-blind survivor both went unseen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_END, CURSOR_START } from '#lib/block-component.js';
import type { BlockEditActions } from '#lib/action-contracts.js';
import { createContainerEditActions } from '#lib/editor-actions/container-edit.js';
import { handleWholeBlockKeys } from '#lib/editor-actions/container-block-component.js';
import { createStandardNestedActions } from '#lib/editor-actions/nested/nested-actions.js';
import { createCaretMemory } from '#lib/cursor/caret-memory.js';
import type { CstNode } from '#lib/core/nodes.js';
import { recordingFocus } from '#lib/testing/headless-actions.js';
import { settleEditor } from '../harness/settle';
import {
	makeBlockListState,
	makeNestedActionsDeps,
	makeTopHarness,
	mountEveryBlock
} from '../harness/editor-actions';

/** Every caret placed, named by the block's path before the delete; a parent's `moveFocus`
 *  counts as one too. */
type Placement = [number[], number] | ['moveFocus', ...unknown[]];

function harness(source: string) {
	const h = makeTopHarness(source);
	const placements: Placement[] = [];
	mountEveryBlock(h.deps, (path, offset) => placements.push([path, offset]));
	const focus = recordingFocus();
	const read = (): Placement[] => [
		...placements,
		...focus.moveFocusCalls.map((args) => ['moveFocus', ...args] as Placement)
	];
	return { h, focus, read };
}

/** The action bundle of the container at top-level `index`, over the real root. */
function containerAt(t: ReturnType<typeof harness>, index: number) {
	const getNode = () => t.h.deps.doc.children[index] as CstNode;
	return createStandardNestedActions(
		makeBlockListState(getNode),
		makeNestedActionsDeps({
			index,
			getNode,
			path: [index],
			parent: {
				blockEdit: t.h.actions,
				focus: t.focus,
				containerEdit: createContainerEditActions(t.h.deps, t.h.controller)
			}
		})
	);
}

function wholeBlockKey(t: ReturnType<typeof harness>, key: string, mods = {}): void {
	const e = { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods };
	handleWholeBlockKeys({ ...e, preventDefault: () => {} } as unknown as KeyboardEvent, {
		getIndex: () => 1,
		getRaw: () => '---\n',
		blockEdit: t.h.actions as Pick<
			BlockEditActions,
			'splitBlock' | 'deleteBlock' | 'insertParagraph'
		>,
		focus: t.focus,
		isReading: () => false,
		caretMemory: createCaretMemory(),
		commandOf: () => null
	});
}

const RULE = 'a\n\n---\n\nb\n';
const ABOVE: Placement = [[0], CURSOR_END];
const BELOW: Placement = [[2], CURSOR_START];

describe('a whole-block delete places one caret, on the side its key points', () => {
	beforeEach(() => {
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		['a delete with no key (the block menu)', (t) => t.h.actions.deleteBlock(1, 'keyless'), ABOVE],
		['whole-block Backspace', (t) => wholeBlockKey(t, 'Backspace'), ABOVE],
		['whole-block Delete', (t) => wholeBlockKey(t, 'Delete'), BELOW],
		['whole-block cut', (t) => wholeBlockKey(t, 'x', { ctrlKey: true }), BELOW]
	] satisfies [string, (t: ReturnType<typeof harness>) => unknown, Placement][])(
		'%s',
		async (_route, run, expected) => {
			const t = harness(RULE);
			await run(t);
			await settleEditor(() => t.read().length > 0);
			await settleEditor();
			expect(t.read()).toEqual([expected]);
		}
	);

	it('a container’s last child hands the delete, and its side, to the parent', async () => {
		const t = harness('a\n\n> ---\n\nb\n');
		await containerAt(t, 1).blockEdit.deleteBlock(0, 'keyless');
		expect(t.read()).toEqual([ABOVE]);
	});

	it('Backspace in a list’s only, empty item deletes the list and lands above, once', async () => {
		const t = harness('a\n\n- \n\nb\n');
		await containerAt(t, 1).blockEdit.mergeWithPrevious(0);
		expect(t.h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
		expect(t.read()).toEqual([ABOVE]);
	});
});
