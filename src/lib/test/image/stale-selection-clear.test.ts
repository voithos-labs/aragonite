// Miss-analysis: nothing tied the selected image's stored bytes to the document, so an undo that
// moved the image left a selection pointing at nothing, and no test edited under a selected image.
import { describe, it, expect } from 'vitest';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { createWidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { parse } from '../../core/parser';
import { createEditorEvents } from '../../editor-events';
import { makeStubController } from '../harness/editor-actions';
import type { Document } from '../../core/nodes';

describe('a selected image whose bytes an edit moves', () => {
	function selectedAt(raw: string, sourceStart: number) {
		let doc: Document = parse(raw);
		const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
		const committer = createImageEditCommitter({
			getDoc: () => doc,
			getEditorEl: () => null,
			widgetSelection,
			controller: makeStubController(),
			events: createEditorEvents()
		});
		widgetSelection.select({ paragraphPath: [0], sourceStart, preSelectOffset: 0 });
		const editTo = (next: string) => {
			doc = parse(next);
			committer.clearStaleSelection();
		};
		return { widgetSelection, editTo };
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
});
