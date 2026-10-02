// @vitest-environment jsdom
// The caret-edge dispatch's toggle branch: a chord at a collapsed caret in live mode leaves a mark
// pending, and the first printable key carries it into the CST as one commit. The pure rewrite is
// `pending-mark-insert.test.ts`; this suite holds that the branch takes the key, spends the marks
// once, and outranks the arrival side.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import type { PendingMarks } from '$lib/cursor/pending-marks';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { makePendingMarks, makeTopHarness } from '$lib/test/harness/editor-actions';
import { serialize } from '$lib/core/serializer';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { fixtureReading } from '../../harness/fixture-grammar';
import { takeDevWarns } from '../../support/warn-gate';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

interface Harness extends EdgeDispatchHarness {
	marks: PendingMarks;
}

function mount(
	source: string,
	pending: InlineMarkKind[],
	{ affinity = null }: { affinity?: EdgeAffinity | null } = {}
): Harness {
	const node = parse(source).children[0];
	const el = mountSurface(trimTrailingLineEnding(node.raw), 'live');
	const marks = makePendingMarks(...pending);
	return {
		...makeEdgeDispatch(node, el, {
			getEdgeAffinity: () => affinity,
			pendingMarks: marks
		}),
		marks
	};
}

installEdgeDispatchCleanup();

describe('the first byte after a chord carries the mark', () => {
	it('wraps the byte and anchors the undo entry at the pre-toggle caret', () => {
		const h = mount('hi\n', ['strong']);
		const e = key('X');

		expect(h.handleKeydown(e, at(2))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'hi**X**\n', 2, 5]]);
	});

	it('spends the set exactly once: the second byte types plain', () => {
		const h = mount('hi\n', ['strong']);
		h.handleKeydown(key('X'), at(2));

		expect(h.marks.get()).toBeNull();
		expect(h.handleKeydown(key('Y'), at(5))).toBe(false);
		expect(h.edits).toHaveLength(1);
	});

	it('carries two marks into one insertion', () => {
		const h = mount('hi\n', ['strong', 'emphasis']);
		expect(h.handleKeydown(key('X'), at(2))).toBe(true);
		expect(h.edits).toEqual([[0, 'hi***X***\n', 2, 6]]);
	});

	// The chain already has strong at this caret, so the mark removes it: the byte escapes the
	// construct rather than being wrapped in a second pair.
	it('escapes the construct when the chain already carries the mark', () => {
		const h = mount('Some **bold** text\n', ['strong']);
		expect(h.handleKeydown(key('X'), at(9))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bo**X**ld** text\n', 9, 12]]);
	});
});

describe('a pending mark outranks every arrival rule', () => {
	// Offset 11 is bold's trailing content edge with the far side recorded, so the typing rules
	// would write past the closer. The mark says otherwise, and wins (live-mode.md § 4.2).
	it('beats the typing caret position at a construct edge', () => {
		const h = mount('Some **bold** text\n', ['emphasis'], { affinity: 'far' });
		expect(h.handleKeydown(key('X'), at(11))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bold*X*** text\n', 11, 13]]);
	});

	it('leaves the caret position in charge once the set is spent', () => {
		const h = mount('Some **bold** text\n', ['emphasis'], { affinity: 'far' });
		h.handleKeydown(key('X'), at(11));
		h.edits.length = 0;

		expect(h.handleKeydown(key('Y'), at(11))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bold**Y text\n', 11, 14]]);
	});
});

describe('the toggle caret position claims only a plain byte at a collapsed caret', () => {
	it('declines with nothing pending, whatever the key', () => {
		const h = mount('hi\n', []);
		expect(h.handleKeydown(key('X'), at(2))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('declines a chord, which is a command rather than a typed byte', () => {
		const h = mount('hi\n', ['strong']);
		for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
			expect(h.handleKeydown(key('X', mods), at(2))).toBe(false);
		}
		// Declining a chord must not spend the marks: Mod+I after Mod+B leaves both pending.
		expect(h.marks.get()).not.toBeNull();
	});

	it('declines a non-printable key and keeps the set for the byte that follows', () => {
		const h = mount('hi\n', ['strong']);
		for (const name of ['Enter', 'Tab', 'ArrowLeft', 'Backspace']) {
			expect(h.handleKeydown(key(name), at(2))).toBe(false);
		}
		expect(h.marks.get()).not.toBeNull();
	});

	it('declines a null caret', () => {
		const h = mount('hi\n', ['strong']);
		expect(h.handleKeydown(key('X'), null)).toBe(false);
	});

	// Miss-analysis: only the arm's own reading-mode check was tested, never the write's refusal.
	it('forced in reading mode, where no mark can be pending, writes nothing and warns', async () => {
		const top = makeTopHarness('hi\n', { reading: fixtureReading({}, 'reading') });
		const node = top.deps.doc.children[0];
		const el = mountSurface('hi', 'live');
		const { handleKeydown } = makeEdgeDispatch(node, el, {
			isReading: () => true,
			pendingMarks: makePendingMarks('strong'),
			blockEdit: top.actions
		});

		expect(handleKeydown(key('X'), at(2))).toBe(true);
		await Promise.resolve();

		expect(serialize(top.deps.doc)).toBe('hi\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
	});
});

// A construct the key empties is unwrapped, so its mark is handed back: the next byte keeps the
// format, and the next chord still turns it off.
describe('a press that empties a construct hands its mark back', () => {
	it('leaves the emptied construct’s mark pending for the next byte', () => {
		const h = mount('plain*x*\n', []);

		expect(h.handleKeydown(key('Backspace'), at(7))).toBe(true);
		expect(h.edits).toEqual([[0, 'plain\n', 7, 5]]);
		expect(h.marks.get()).toEqual(new Set(['emphasis']));
	});

	it('pends nothing where the press empties no construct', () => {
		const h = mount('Some **bold** text\n', []);

		expect(h.handleKeydown(key('Backspace'), at(13))).toBe(true);
		expect(h.marks.get()).toBeNull();
	});

	// A link unwraps on empty like a mark does, but no chord writes one, so there is nothing to
	// hand back and a pended `link` would be a promise the insertion cannot keep.
	it('pends nothing for an unwrapped kind no format chord writes', () => {
		const h = mount('a [x](u) b\n', []);

		expect(h.handleKeydown(key('Backspace'), at(4))).toBe(true);
		expect(h.edits).toEqual([[0, 'a  b\n', 4, 2]]);
		expect(h.marks.get()).toBeNull();
	});
});
