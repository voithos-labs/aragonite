// @vitest-environment jsdom
// Miss-analysis: no test edited under a selected image, so an undo that moved it went unchecked.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { imageFieldsFromInline } from '../../core/inline/image-source-bytes';
import { getInlineContent } from '../../core/inline/inline-cache';
import type { CstNode } from '../../core/nodes';
import { selectWidgetWhole } from '../../selection/place-caret';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';
import { createEditorEvents } from '../../editor-events';
import { makeInlineRange, makeStubController } from '../harness/editor-actions';
import type { Document } from '../../core/nodes';
import { fixtureReading } from '../harness/fixture-grammar';

/** The widget starting at `sourceStart` in block 0 of `raw`, selected, and an edit to it. */
function selectedAt(raw: string, sourceStart: number) {
	let doc: Document = parse(raw);
	const selection = createSelectionState();
	const committer = createImageEditCommitter({
		getDoc: () => doc,
		getEditorEl: () => null,
		selection,
		inlineRange: makeInlineRange(() => doc, makeStubController()),
		events: createEditorEvents(),
		reading: fixtureReading()
	});
	selectWidgetWhole(selection, { paragraphPath: [0], sourceStart, preSelectOffset: 0 });
	const editTo = (next: string) => {
		doc = parse(next);
		committer.clearStaleSelection();
	};
	const firstImageFields = () =>
		imageFieldsFromInline(
			getInlineContent(doc.children[0] as CstNode, undefined, undefined, defaultGrammarView).find(
				(node) => node.kind === 'image'
			)!
		);
	return { selection, committer, editTo, firstImageFields };
}

describe('a selected image whose bytes an edit moves', () => {
	it('is deselected when the edit leaves no image at its start byte', () => {
		const s = selectedAt('abcxyz ![c](a.png) tail\n', 7);
		s.editTo('abc ![c](a.png) tail\n');
		expect(s.selection.widget).toBeNull();
	});

	it("stays selected through the image's own rewrite, which keeps its start byte", () => {
		const s = selectedAt('abc ![c](a.png) tail\n', 4);
		s.editTo('abc ![a new alt](a.png) tail\n');
		expect(s.selection.widget?.sourceStart).toBe(4);
	});

	// Miss-analysis: no case wrote an image in front of the selected one, as the popover does.
	it('follows a second image that a written edit to the first one moved', async () => {
		const s = selectedAt('![a](a.png) ![b](a.png)\n', 12);
		const first = { paragraphPath: [0], sourceStart: 0, preSelectOffset: 11 };
		s.committer.commitImageEdit(first, s.firstImageFields(), { alt: 'a longer', url: 'a.png' });
		s.editTo('![a longer](a.png) ![b](a.png)\n');
		await tick();

		expect(s.selection.widget?.sourceStart).toBe(19);
	});
});

// Miss-analysis: every stale-drop case selected an image, so the drop asking for an image only
// never met a selected `<br>`, which it dropped on the first edit anywhere in the document.
describe('a selected widget of another kind', () => {
	it.each([
		['stays selected through an edit that keeps it', 'before<br>after more\n', 6],
		['is deselected once the edit removes it', 'before after\n', null]
	])('a `<br>` %s', (_, next, expected) => {
		const s = selectedAt('before<br>after\n', 6);
		s.editTo(next);
		expect(s.selection.widget?.sourceStart ?? null).toBe(expected);
	});
});
