// Miss-analysis: nothing tied the selected image's stored bytes to the document, so an undo that
// moved the image left a selection pointing at nothing, and no test edited under a selected image.
import { defaultGrammarView } from '$lib/schema/block-openers';
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { imageFieldsFromInline } from '../../components/image/image-source-bytes';
import { getInlineContent } from '../../core/inline/inline-cache';
import type { CstNode } from '../../core/nodes';
import { createWidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { parse } from '../../core/parser';
import { createEditorEvents } from '../../editor-events';
import { makeStubController } from '../harness/editor-actions';
import type { Document } from '../../core/nodes';
import { fixtureReading } from '../harness/fixture-grammar';

describe('a selected image whose bytes an edit moves', () => {
	function selectedAt(raw: string, sourceStart: number) {
		let doc: Document = parse(raw);
		const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
		const committer = createImageEditCommitter({
			getDoc: () => doc,
			getEditorEl: () => null,
			widgetSelection,
			controller: makeStubController(),
			events: createEditorEvents(),
			reading: fixtureReading()
		});
		widgetSelection.select({ paragraphPath: [0], sourceStart, preSelectOffset: 0 });
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
		return { widgetSelection, committer, editTo, firstImageFields };
	}

	it('is deselected when the edit leaves no image at its start byte', () => {
		const s = selectedAt('abcxyz ![c](a.png) tail\n', 7);
		s.editTo('abc ![c](a.png) tail\n');
		expect(s.widgetSelection.getSelected()).toBeNull();
	});

	it("stays selected through the image's own rewrite, which keeps its start byte", () => {
		const s = selectedAt('abc ![c](a.png) tail\n', 4);
		s.editTo('abc ![a new alt](a.png) tail\n');
		expect(s.widgetSelection.getSelected()?.sourceStart).toBe(4);
	});

	// Miss-analysis: both cases above moved or kept the selected image itself, so none wrote a
	// different image in front of it, which the popover does when a click moves on to a second one.
	it('follows a second image that a written edit to the first one moved', async () => {
		const s = selectedAt('![a](a.png) ![b](a.png)\n', 12);
		const first = { paragraphPath: [0], sourceStart: 0, preSelectOffset: 11 };
		s.committer.commitImageEdit(first, s.firstImageFields(), { alt: 'a longer', url: 'a.png' });
		s.editTo('![a longer](a.png) ![b](a.png)\n');
		await tick();

		expect(s.widgetSelection.getSelected()?.sourceStart).toBe(19);
	});
});
