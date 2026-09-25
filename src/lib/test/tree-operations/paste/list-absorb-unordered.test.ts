// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { parse } from '$lib/core/parser';
import {
	makeRunningPasteController,
	makeStubBlockEdit,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import { metadataOf } from '$lib/core/nodes';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

// Absorbing a same-type list paste must normalize markers for both halves: a `*` kept
// inside a `- ` list is split into two lists by reference parsers.

describe('list-absorb: marker normalization', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
	});

	it("templates pasted '*' markers to the enclosing '-' list", async () => {
		const doc = parse('- alpha\n- beta\n');
		const list = doc.children[0];
		registerStubBlockListState(list);

		// A single-caret paste routes to list-absorb rather than the container-match merge.
		await pasteDispatch(
			{ pastedText: '* one\n* two\n', targetPath: [0, 0, 0], offset: 'alpha'.length },
			pasteContext({
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController()
			})
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
