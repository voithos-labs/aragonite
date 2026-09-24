// @vitest-environment jsdom
//
// The caret-edge dispatch at a block whose structure sits past its content (a setext underline).
// Neither end is the dispatch's to take: Delete at the content end goes to the block command, whose
// join lands the next block's text above the underline, and Backspace at the content start goes to
// the demote (`merge-prev-demote.test.ts`).
// Miss-analysis: these suites mount bare containers with no presentation root, so the
// marker-hiding modes had no fixture to fail in.
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

/** `source` as one block under an optional presentation root; markers get their own spans. */
function mount(source: string, mode?: string): EdgeDispatchHarness {
	const node = parse(source).children[0];
	return makeEdgeDispatch(node, mountSurface(trimTrailingLineEnding(node.raw), mode));
}

installEdgeDispatchCleanup();

describe('Delete at a setext heading’s content end reaches the block command', () => {
	// `Title\n===`: the underline is structural, so content ends at 5.
	for (const mode of [undefined, 'live', 'preview-block', 'preview-inline']) {
		it(`is left unclaimed in ${mode ?? 'source'} mode`, () => {
			const h = mount('Title\n===\n', mode);
			const e = key('Delete');
			expect(h.handleKeydown(e, at(5))).toBe(false);
			expect(e.defaultPrevented).toBe(false);
			expect(h.edits).toHaveLength(0);
		});
	}
});

describe('the prefix side belongs to the block-edge command, not to this dispatch', () => {
	// The key falls through the whole dispatch so `block.mergePrev` can demote the heading;
	// consuming it here would silently take the gesture back.
	it.each([
		['a heading’s content start', '## Title\n', 3],
		['a setext heading’s content start', 'Title\n===\n', 0]
	])('declines Backspace at %s', (_case, source, offset) => {
		const h = mount(source, 'live');
		expect(h.handleKeydown(key('Backspace'), at(offset))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});
});
