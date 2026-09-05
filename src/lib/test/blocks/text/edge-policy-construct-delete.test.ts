// @vitest-environment jsdom
//
// The caret-edge dispatch's destructive arm at an inline construct. A mode that paints no marker
// puts delimiter bytes beside the caret that no reader can aim at, so the press is intercepted and
// the CONTENT character goes instead — and with it the pair the cut empties, in the same commit.
// Miss-analysis: the pure rewrite can be exercised anywhere, but nothing pinned WHICH presses the
// dispatch hands it, and the mode gate is the whole difference between live and every other rung.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

/** `source` as one block under an optional presentation root. */
function mount(source: string, mode?: string): EdgeDispatchHarness {
	const node = parse(source).children[0];
	return makeEdgeDispatch(node, mountSurface(trimTrailingLineEnding(node.raw), mode));
}

installEdgeDispatchCleanup();

describe('a destructive key past a construct edge takes the content byte', () => {
	it('rewrites through the CST and anchors the undo entry at the pre-edit caret', () => {
		const h = mount('Some **bold** text\n', 'live');
		const e = key('Backspace');
		expect(h.handleKeydown(e, at(13))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bol** text\n', 13, 10]]);
	});

	it('drops the delimiters the cut empties in the same commit', () => {
		const h = mount('**b** tail\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(3))).toBe(true);
		expect(h.edits).toEqual([[0, ' tail\n', 3, 0]]);
	});

	it('takes the first content byte on Delete at a leading run', () => {
		const h = mount('**bold** x\n', 'live');
		expect(h.handleKeydown(key('Delete'), at(0))).toBe(true);
		expect(h.edits).toEqual([[0, '**old** x\n', 0, 0]]);
	});

	// Away from every hidden run the engine is right and owns the press, grapheme and IME
	// behavior included.
	it('leaves an ordinary content byte to native', () => {
		const h = mount('Some **bold** text\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(9))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	// No sound rewrite exists for `**a **` (a closing run after a space is not right-flanking), and
	// the engine's version of that press destroys both constructs and paints the stars. The arm
	// takes the key and writes nothing — the same shape as the hidden-suffix guard.
	it('takes the press and writes nothing where no rewrite parses back', () => {
		const h = mount('**a *b*** z\n', 'live');
		const e = key('Backspace');
		expect(h.handleKeydown(e, at(6))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toHaveLength(0);
	});

	// The bytes past the content range are the block's own, so this arm writes nothing there
	// however the block-edge path answers the press.
	it('writes nothing at a heading’s content start', () => {
		const h = mount('## **b** x\n', 'live');
		h.handleKeydown(key('Backspace'), at(3));
		expect(h.edits).toHaveLength(0);
	});
});

describe('the arm claims a press only where the markers are unpainted', () => {
	it('declines in source mode, which paints every delimiter', () => {
		const h = mount('Some **bold** text\n', undefined);
		expect(h.handleKeydown(key('Backspace'), at(13))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	// The preview rungs reveal the focused construct, so its delimiters are editable bytes.
	for (const mode of ['preview-block', 'preview-inline']) {
		it(`declines in ${mode}`, () => {
			const h = mount('Some **bold** text\n', mode);
			expect(h.handleKeydown(key('Backspace'), at(13))).toBe(false);
		});
	}

	// A chord is a word-scoped platform command; the arm owns only the plain press.
	it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])(
		'declines %o+Backspace',
		(mods) => {
			const h = mount('Some **bold** text\n', 'live');
			expect(h.handleKeydown(key('Backspace', mods), at(13))).toBe(false);
		}
	);
});
