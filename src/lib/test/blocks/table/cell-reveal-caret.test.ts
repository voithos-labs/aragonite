// @vitest-environment jsdom
//
// The caret half of the cell's write door, driven through the mounted component.
// A cell's `normalizeRawWrite` escapes every free `|` at the write sink, so an
// offset reported against the text a gesture just wrote lands one byte early per
// escape inserted before it. The door maps the COMMIT caret; the pending cursor is
// a separate dep that bypasses it, and a reveal commit is the gesture that can put
// a fresh `|` in front of its own caret — the user types it inside the revealed
// `$…$` source, where onInput is suppressed and nothing normalizes until the fold.
//
// Pinned by driving the real gestures (arrow into the widget, edit the ephemeral
// source DOM, Enter) and reading the caret the cell actually restored, so the two
// halves of the door are asserted against each other rather than against a
// hand-computed number.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import TableCellBlock from '$lib/components/blocks/table/TableCellBlock.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode } from '$lib/core/nodes';
import type { EditorServices } from '$lib/editor-keys';
import { TABLE_CONTEXT_KEY } from '$lib/editor-keys';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';
import { resetInlineState } from '../text/math-widget-fixture';

const noIslands = { islandsForPath: () => [] } as unknown as EditorServices['decorations'];

// `x $a$ yz`: a math widget at raw [2,5) with prose on both sides, so every caret
// offset this test names sits OUTSIDE the widget span and reads back unambiguously.
const CELL = 'x $a$ yz';

function mountCell(raw: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const node: CstNode = { kind: 'tableCell', leadingTrivia: '', raw };
	const blockEdit = makeStubBlockEdit();
	const context = editorMountContext({
		blockEdit,
		doc: { doc: () => ({ kind: 'document', prefix: '', children: [node], suffix: '' }) },
		services: {
			decorations: noIslands,
			widgetSelection: createWidgetSelectionState({ onSelect: () => {} })
		}
	});
	context.set(TABLE_CONTEXT_KEY, {
		notifyCellFocused: vi.fn(),
		notifyCellBlurred: vi.fn(),
		focusCell: vi.fn(),
		setStickyColumn: vi.fn()
	});
	const refs: (BlockComponent | undefined)[] = [];
	const instance = mount(TableCellBlock, {
		target,
		props: {
			node,
			index: 0,
			myPath: [0, 1, 0],
			rowIdx: 1,
			colIdx: 0,
			columnCount: 2,
			rowCount: 2,
			setRef: (i: number, r: BlockComponent | undefined) => {
				refs[i] = r;
			},
			getRef: (i: number) => refs[i]
		},
		context
	});
	flushSync();
	return { instance, el: target.querySelector('.table-cell') as HTMLElement, blockEdit };
}

function press(el: HTMLElement, key: string): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** The keydown handlers await the shared prelude, so a commit lands several
 *  microtasks after dispatch — and the render effect one more after that. */
async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await tick();
}

/** The ephemeral source text node the reveal swapped the widget island for. */
function revealedSource(el: HTMLElement): Text {
	const found = Array.from(el.childNodes).find(
		(c) => c.nodeType === Node.TEXT_NODE && c.textContent === '$a$'
	);
	expect(found, 'the reveal did not swap the widget for its source').toBeDefined();
	return found as Text;
}

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
	resetInlineState();
});

describe('a reveal commit in a cell parks its caret in escaped space', () => {
	it('a `|` typed into the revealed source moves the caret it sits before', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);

		// ArrowLeft at the widget's trailing edge opens its source reveal; the edit
		// inside it is ephemeral DOM by design (onInput is suppressed while revealed).
		press(el, 'ArrowLeft');
		await settle();
		revealedSource(el).textContent = '$a|$';
		press(el, 'Enter');
		await settle();

		// The door escaped the free `|`, so the commit caret is 7 — past `$a\|$`.
		const [, , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(7);
		// The parked caret addresses the same bytes, so it must be the same offset.
		// Unmapped it is 6, which in the written raw sits between the inserted `\`
		// and the `|` it frees — inside the widget the user just finished editing.
		expect(instance.getCursorOffset()).toBe(committedCaret);
	});

	it('a source edit with no free pipe parks where it always did', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);

		press(el, 'ArrowLeft');
		await settle();
		revealedSource(el).textContent = '$ab$';
		press(el, 'Enter');
		await settle();

		// Non-vacuity: the mapping is identity when the sink inserts nothing, so the
		// escape path cannot be a blanket offset shift.
		const [, , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(6);
		expect(instance.getCursorOffset()).toBe(6);
	});
});
