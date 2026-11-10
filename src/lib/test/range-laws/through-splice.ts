// With `BYTE_SPLICE` set, every gesture that changes bytes is replayed through the byte splice:
// today's gesture runs, its bytes and caret are read, undo puts the document back, and the splice
// writes the same bytes and caret. The laws then judge the splice's tree, undo entry and caret.
// `BYTE_SPLICE_LOG` names a file each caret the byte form can't tell apart is written to.

import type { OpDescriptor } from '#lib/schema/operations.js';
import type { SpliceCaret } from '#lib/action-contracts.js';
import type { Editor } from './gestures';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { appendFileSync } from 'node:fs';
import { byteOfLeaf } from '#lib/tree-operations/container-offsets.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { isWholeBlockUnit } from '#lib/schema/whole-block-unit.js';
import { isBlankParagraph } from '#lib/core/parser.js';
import { placeRange, Undetermined } from './gestures';
import { measured } from '#lib/tree-operations/top-level-starts.js';

const ON = !!process.env.BYTE_SPLICE;

/** `gesture` over `editor`, and with `BYTE_SPLICE` set, its answer written again by the splice. */
export async function throughSplice<T>(
	editor: Editor,
	op: OpDescriptor,
	gesture: () => Promise<T>
): Promise<T> {
	if (!ON) return gesture();
	const before = editor.source();
	const began = editor.instance.getSelection();
	const result = await gesture();
	const after = editor.source();
	if (after === before) return result;
	const selection = JSON.stringify(editor.instance.getSelection());
	const gap = JSON.stringify(editor.instance.__test.getGapCaret());
	const caret = caretOf(editor);
	if (!caret) throw new Undetermined(`no byte names the caret the gesture left: ${selection}`);
	editor.instance.runCommand('history.undo');
	await editor.settle();
	if (editor.source() !== before) throw new Undetermined('undo did not give the bytes back');
	// jsdom's undo restores no selection, and the splice's undo entry reads the live one.
	if (began) await placeRange(editor, began);
	await editor.instance.__test.spliceSource(after, caret, op);
	await editor.settle();
	const landed = editor.source();
	if (landed !== after) throw new Error(`the splice wrote ${q(landed)}, the gesture ${q(after)}`);
	const now = JSON.stringify(editor.instance.getSelection());
	const nowGap = JSON.stringify(editor.instance.__test.getGapCaret());
	if (now !== selection || nowGap !== gap) {
		const shape = sameSpot(
			editor,
			editor.instance.getSelection()?.focus,
			JSON.parse(selection)?.focus
		);
		if (shape) {
			const log = process.env.BYTE_SPLICE_LOG;
			if (log) appendFileSync(log, `${shape}: ${now} for ${selection} over ${q(after)}\n`);
			return result;
		}
		throw new Error(
			`the splice put the caret at ${now} (gap ${nowGap}), the gesture at ${selection} (gap ${gap}), over ${q(after)}`
		);
	}
	return result;
}

const q = (text: string) => JSON.stringify(text);

/** Why two carets differ where the landing takes a block's own focus rule, or null for any other
 *  difference: one byte two leaves meet at, a blank block, or a live run of hidden delimiters. */
function sameSpot(
	editor: Editor,
	landed: SelectionPoint | undefined,
	wanted: SelectionPoint | undefined
): string | null {
	if (!landed || !wanted) return null;
	const doc = editor.instance.__test.getDocument();
	const [a, b] = [landed, wanted].map((p) => byteOfLeaf(measured(doc), p.path, p.offset));
	if (a === null || b === null) return null;
	if (a === b) return 'one byte, two leaves';
	if (isBlankParagraph(blockNodeAt(doc, wanted.path) ?? { kind: '', raw: 'x' }))
		return 'blank block';
	const between = editor.source().slice(Math.min(a, b), Math.max(a, b));
	const live = editor.props.presentationMode === 'live';
	const samePath = landed.path.join() === wanted.path.join();
	return live && samePath && /^[*_~`$]+$/.test(between) ? 'hidden delimiters' : null;
}

/** The caret the editor holds, as a byte of its bytes and what sits there; null for a range or a
 *  cell, which no byte names. */
export function caretOf(editor: Editor): SpliceCaret | null {
	const doc = editor.instance.__test.getDocument();
	const gap = editor.instance.__test.getGapCaret();
	if (gap) {
		const { parentPath, index } = gap;
		const parent = parentPath.length === 0 ? doc : blockNodeAt(doc, parentPath);
		if (!parent?.children) return null;
		if (index < parent.children.length) {
			const at = byteOfLeaf(measured(doc), [...parentPath, index], 0);
			return at === null ? null : { at, holds: 'boundary' };
		}
		const start = parentPath.length === 0 ? 0 : byteOfLeaf(measured(doc), parentPath, 0);
		const length =
			parentPath.length === 0 ? editor.source().length : (parent as { raw: string }).raw.length;
		return start === null ? null : { at: start + length, holds: 'boundary' };
	}
	const selection = editor.instance.getSelection();
	if (!selection) return null;
	const { anchor, focus } = selection;
	if (anchor.cellCoordinate || focus.cellCoordinate) return null;
	if (anchor.path.join() !== focus.path.join() || anchor.offset !== focus.offset) return null;
	const node = blockNodeAt(doc, anchor.path);
	const at = byteOfLeaf(measured(doc), anchor.path, anchor.offset);
	if (!node || at === null) return null;
	return { at, holds: isWholeBlockUnit(node) ? 'block' : 'text' };
}
