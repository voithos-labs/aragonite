// @vitest-environment jsdom
//
// A cell's raw is joined verbatim into its row, so an unescaped `|` reaching
// `cell.raw` reparses the row wider than the delimiter's column count and the
// parser truncates — the last column's content is deleted, silently. Three
// gestures compute their own bytes and commit them: Mod+B, Shift+Enter, and the
// menu Cut. Each is driven here through the mounted component, against a cell
// whose authored `\|` the gesture frees.
//
// Each gesture's committed text is read through the write sink, which is where
// the kind's escape runs: the gesture is responsible for reaching the sink, not
// for knowing the rule. Measuring at the component's own call would only prove
// the gesture escaped its bytes itself, which is the carrier these fixed.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import TableCellBlock from '$lib/components/blocks/table/TableCellBlock.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode } from '$lib/core/nodes';
import type { EditorServices } from '$lib/editor-keys';
import { TABLE_CONTEXT_KEY } from '$lib/editor-keys';
import { splitRowCells } from '$lib/core/parsers/table';
import { updateNodeContent } from '$lib/tree-operations/node-ops';
import { rebuildTableRowRaw } from '$lib/schema/container-rebuilders';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

const noIslands = { islandsForPath: () => [] } as unknown as EditorServices['decorations'];

// The cell holds `a\|b` — an escaped pipe. The renderer emits the backslash as a
// marker span and the `|` as text, so both bytes are in textContent and the
// caret can sit between them.
const ESCAPED = 'a\\|b';

function mountCell(raw: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const node: CstNode = { kind: 'tableCell', leadingTrivia: '', raw };
	const blockEdit = makeStubBlockEdit();
	const context = editorMountContext({
		blockEdit,
		doc: { doc: () => ({ kind: 'document', prefix: '', children: [node], suffix: '' }) },
		services: { decorations: noIslands }
	});
	context.set(TABLE_CONTEXT_KEY, {
		notifyCellFocused: vi.fn(),
		notifyCellBlurred: vi.fn(),
		focusCell: vi.fn(),
		setStickyColumn: vi.fn()
	});
	// The right-click-menu clipboard reaches the cell through its published ref,
	// not a component export — capture the slot the way BlockList does.
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
	const el = target.querySelector('.table-cell') as HTMLElement;
	return { instance, el, blockEdit, ref: () => refs[0]! };
}

/** The raw the gesture committed for this cell. */
function committedRaw(blockEdit: ReturnType<typeof makeStubBlockEdit>): string {
	const calls = vi.mocked(blockEdit.updateBlockContent).mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1];
}

// The before-input handler awaits the shared prelude before committing, so the
// commit lands several microtasks after dispatch.
async function settleCommit(blockEdit: ReturnType<typeof makeStubBlockEdit>): Promise<void> {
	for (let i = 0; i < 8 && vi.mocked(blockEdit.updateBlockContent).mock.calls.length === 0; i++) {
		await tick();
	}
}

/** Cells the row reparses into once the sink has written the gesture's text. */
function reparsedCells(committed: string): string[] {
	const row: CstNode = {
		kind: 'tableRow',
		leadingTrivia: '',
		raw: '',
		metadata: { isHeader: false },
		children: [
			{ kind: 'tableCell', leadingTrivia: '', raw: '' },
			{ kind: 'tableCell', leadingTrivia: '', raw: 'keep' }
		]
	};
	updateNodeContent(row as never, 0, committed);
	rebuildTableRowRaw(row, '\n');
	return splitRowCells(row.raw);
}

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('table cell write paths escape the pipes they free', () => {
	it('Mod+B over the escape keeps the row at two cells', () => {
		mounted = mountCell(ESCAPED);
		const { el, blockEdit } = mounted;
		el.focus();
		mounted.instance.setSelection(0, 2);

		expect(mounted.instance.runCommand('format.toggleStrong')).toBe(true);

		expect(reparsedCells(committedRaw(blockEdit))).toEqual(['**a\\**\\|b', 'keep']);
	});

	it('Shift+Enter between the backslash and the pipe keeps the row at two cells', async () => {
		mounted = mountCell(ESCAPED);
		const { el, blockEdit } = mounted;
		el.focus();
		mounted.instance.setSelection(2, 2);

		el.dispatchEvent(
			new InputEvent('beforeinput', {
				inputType: 'insertLineBreak',
				bubbles: true,
				cancelable: true
			})
		);
		await settleCommit(blockEdit);

		expect(reparsedCells(committedRaw(blockEdit))).toEqual(['a\\<br>\\|b', 'keep']);
	});

	it('cutting the escape away keeps the row at two cells', async () => {
		mounted = mountCell(ESCAPED);
		const { el, blockEdit } = mounted;
		document.execCommand = vi.fn(() => true);
		el.focus();

		await mounted.ref().applyMenuClipboard!('cut', { start: 0, end: 2 });

		expect(reparsedCells(committedRaw(blockEdit))).toEqual(['\\|b', 'keep']);
	});
});
