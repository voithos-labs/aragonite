// @vitest-environment jsdom
//
// The caret-edge dispatch's hidden-structure branch, which covers one side only: Delete at a
// block whose own structure sits after its content. The merge that key would reach joins past the
// suffix and brings it into view, so the dispatch consumes the key. The prefix side belongs to
// the demote (`merge-prev-demote.test.ts`), and the last case here holds that split.
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

describe('a hidden structural suffix swallows Delete at content end', () => {
	// `Title\n===`: the underline is structural, so content ends at 5.
	it('consumes the press at a setext heading’s content end in live', () => {
		const h = mount('Title\n===\n', 'live');
		const e = key('Delete');
		expect(h.handleKeydown(e, at(5))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toHaveLength(0);
	});

	// Source mode draws the underline, so Delete there acts on bytes the user can see.
	it('declines in source mode', () => {
		const h = mount('Title\n===\n', undefined);
		expect(h.handleKeydown(key('Delete'), at(5))).toBe(false);
	});

	// The preview modes show the focused block's own structure, so its bytes are editable.
	for (const mode of ['preview-block', 'preview-inline']) {
		it(`declines in ${mode}`, () => {
			const h = mount('Title\n===\n', mode);
			expect(h.handleKeydown(key('Delete'), at(5))).toBe(false);
		});
	}

	// A heading's content runs to the block end, so Delete there is an ordinary merge.
	it('leaves an ATX heading’s end to the merge path', () => {
		const h = mount('## Title\n', 'live');
		expect(h.handleKeydown(key('Delete'), at(8))).toBe(false);
	});

	it('leaves the press mid-content alone', () => {
		const h = mount('Title\n===\n', 'live');
		expect(h.handleKeydown(key('Delete'), at(3))).toBe(false);
	});

	// A chord is a word-scoped platform command; only the plain key is consumed.
	it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])(
		'declines %o+Delete',
		(mods) => {
			const h = mount('Title\n===\n', 'live');
			expect(h.handleKeydown(key('Delete', mods), at(5))).toBe(false);
		}
	);
});

describe('the prefix side belongs to the block-edge command, not to this branch', () => {
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
