// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { makeRunningPasteController, makeStubBlockEdit } from '$lib/test/harness/editor-actions';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// B-F3: container-match was the one paste route reading the intolerant door, so an unmounted
// outer scope made it the only route that drops the clipboard silently — on the arm where a
// cross-block delete has already committed.
// Miss-analysis: every container-match case registers a state for the outer node first, so the
// unmounted arm the other four routes are pinned on had no draw here.

describe('container-matching paste at an unmounted outer scope', () => {
	it('splices the clipboard through the tolerant door rather than dropping it', async () => {
		const doc = parse('- a\n- keep\n');
		const list = doc.children[0];
		// A post-cross-block-delete stub, with no BlockListState registered for the list.
		list.children![0].children![0].raw = '';

		await pasteDispatch(
			{ pastedText: '- x\n- y\n', targetPath: [0, 0, 0], offset: 0 },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController(),
				undoEntry: 'join'
			}
		);

		expect(serialize(doc)).toBe('- x\n- y\n- keep\n');
		allowDevWarns(['paste']);
	});
});
