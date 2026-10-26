// @vitest-environment jsdom
// G1.117: a write never turns a CRLF pair into a lone `\r` or a lone `\n`. G1.119: no caret the
// editor writes sits inside one.
// Miss-analysis: no check compared a document's line endings across a write, so a split pair
// reached the bytes silently.
import { describe, it, expect } from 'vitest';
import {
	checkCaretOutsideLineEndingPair,
	checkLineEndingPairsKept
} from '../../invariants/line-ending-pairs';
import { testCaretWriter } from '../harness/caret-writer';
import { lineEndingCounts } from '../../core/line-ending-pairs';
import { serialize } from '../../core/serializer';
import { makeTopHarness } from '../harness/editor-actions';
import { takeDevWarns } from '../support/warn-gate';

const counts = lineEndingCounts;
const BEFORE = 'abc\r\nAfter\r\n';

describe('G1.117 a write keeps every CRLF pair whole', () => {
	it('names a pair split into a lone `\\r`, a lone `\\n`, or both', () => {
		for (const after of ['abc\rZ\nAfter\r\n', 'abc\rAfter\r\n', 'abc\nAfter\r\n']) {
			expect(checkLineEndingPairsKept(counts(BEFORE), counts(after))?.code, after).toBe(
				'line-ending-pairs'
			);
		}
	});

	it('passes a pair deleted whole, a new lone `\\r` with no pair lost, and LF text', () => {
		expect(checkLineEndingPairsKept(counts(BEFORE), counts('abcAfter\r\n'))).toBeNull();
		expect(checkLineEndingPairsKept(counts(BEFORE), counts('a\rbc\r\nAfter\r\n'))).toBeNull();
		expect(checkLineEndingPairsKept(counts('a\nb\n'), counts('ab\n'))).toBeNull();
	});

	it('fires from a keystroke write that splits a pair', async () => {
		const h = makeTopHarness(BEFORE);
		takeDevWarns();
		await h.actions.updateBlockContent(0, 'abc\rZ\nAfter', 'authored', 'join-typing', 4, 5);
		expect(serialize(h.deps.doc)).toContain('\rZ\n');
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:line-ending-pairs');
	});
});

describe('G1.119 no caret the editor writes sits inside a CRLF pair', () => {
	it('names an endpoint between the halves, passes one on either side', () => {
		const text = document.createTextNode('abc\r\nAfter');
		expect(checkCaretOutsideLineEndingPair({ node: text, offset: 4 })?.code).toBe(
			'caret-in-line-ending-pair'
		);
		for (const offset of [3, 5]) {
			expect(checkCaretOutsideLineEndingPair({ node: text, offset })).toBeNull();
		}
	});

	it('fires from the caret writer', () => {
		const el = document.createElement('div');
		el.textContent = 'abc\r\nAfter';
		document.body.appendChild(el);
		takeDevWarns();
		testCaretWriter.selectDomRange({
			startContainer: el.firstChild!,
			startOffset: 4,
			endContainer: el.firstChild!,
			endOffset: 4
		} as unknown as Range);
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:caret-in-line-ending-pair');
		el.remove();
	});
});

describe('the caret writer extends from an anchor parked inside a CRLF pair', () => {
	it('keeps the anchor before the pair, where the read puts it', () => {
		const el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		el.textContent = 'abc\r\nAfter';
		document.body.appendChild(el);
		const text = el.firstChild as Text;
		window.getSelection()!.collapse(text, 4);
		takeDevWarns();
		testCaretWriter.extendSelectionToRaw(el, 5);
		const sel = window.getSelection()!;
		expect([sel.anchorOffset, sel.focusOffset]).toEqual([3, 5]);
		expect(takeDevWarns()).toEqual([]);
		el.remove();
	});
});
