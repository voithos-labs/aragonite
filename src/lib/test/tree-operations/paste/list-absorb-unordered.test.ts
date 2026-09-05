// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { pasteDispatch, __getDefaultTextSurface } from '$lib/tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '$lib/tree-operations/paste-surfaces';
import { parse } from '$lib/core/parser';
import {
	makeRunningPasteController,
	makeStubBlockEdit,
	registerStubBlockListState
} from '../../harness/editor-actions';
import { metadataOf } from '$lib/core/nodes';

// Absorbing a same-type list paste must normalize markers for BOTH halves: a `*` kept
// inside a `- ` list is split into two lists by reference parsers.

describe('list-absorb — marker normalization', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
		registerPasteSurface(__getDefaultTextSurface('paragraph'));
	});

	it("templates pasted '*' markers to the enclosing '-' list", async () => {
		const doc = parse('- alpha\n- beta\n');
		const list = doc.children[0];
		registerStubBlockListState(list);

		// A single-caret paste routes to list-absorb rather than the container-match merge.
		await pasteDispatch(
			{ pastedText: '* one\n* two\n', targetPath: [0, 0, 0], offset: 'alpha'.length },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeRunningPasteController() }
		);

		const markers = list.children!.map((it) => metadataOf(it, 'listItem').marker);
		expect(markers).toEqual(['- ', '- ', '- ', '- ']);
		expect(list.children!.map((it) => it.raw.startsWith('* '))).toEqual([
			false,
			false,
			false,
			false
		]);
		expect(list.children!.map((it) => it.children?.[0]?.raw?.trim())).toEqual([
			'alpha',
			'one',
			'two',
			'beta'
		]);
	});
});
