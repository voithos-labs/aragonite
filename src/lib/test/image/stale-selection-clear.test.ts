// Miss-analysis: no test edited under a selected image, so an undo that moved it went unchecked.
import { defaultGrammarView } from '$lib/schema/block-openers';
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { imageFieldsFromInline } from '../../core/inline/image-source-bytes';
import { getInlineContent } from '../../core/inline/inline-cache';
import type { CstNode } from '../../core/nodes';
import { createWidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { parse } from '../../core/parser';
import { createEditorEvents } from '../../editor-events';
import { makeInlineRange, makeStubController } from '../harness/editor-actions';
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
			inlineRange: makeInlineRange(() => doc, makeStubController()),
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

	// Miss-analysis: no case wrote an image in front of the selected one, as the popover does.
	it('follows a second image that a written edit to the first one moved', async () => {
		const s = selectedAt('![a](a.png) ![b](a.png)\n', 12);
		const first = { paragraphPath: [0], sourceStart: 0, preSelectOffset: 11 };
		s.committer.commitImageEdit(first, s.firstImageFields(), { alt: 'a longer', url: 'a.png' });
		s.editTo('![a longer](a.png) ![b](a.png)\n');
		await tick();

		expect(s.widgetSelection.getSelected()?.sourceStart).toBe(19);
	});
});
