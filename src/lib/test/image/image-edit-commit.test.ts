// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { parse } from '../../core/parser';
import { parseAllInlineContent } from '../../core/inline';
import type { UndoController } from '../../editor-actions/deps';
import type { WidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import type { EditorEvents } from '../../editor-events';
import type { CstNode } from '../../core/nodes';

function makeStubController() {
	return {
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(),
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn(),
		clearDebouncedCheckpoint: vi.fn()
	} as unknown as UndoController;
}

describe('image edit commit — redundant-commit guard (E1)', () => {
	it('does not commit when the new image bytes equal the current source', async () => {
		const doc = parse('![alt](url)\n');
		parseAllInlineContent(doc.children);
		const para = doc.children[0] as CstNode;
		const image = (para.inlineContent ?? []).find((n) => n.kind === 'image')!;

		const controller = makeStubController();
		const committer = createImageEditCommitter({
			getDoc: () => doc,
			getEditorEl: () => null,
			widgetSelection: { getSelected: () => null } as unknown as WidgetSelectionState,
			controller,
			events: { emit: vi.fn(), on: vi.fn() } as unknown as EditorEvents
		});

		// Commit the image's existing fields back — produces byte-identical raw.
		// (Mirrors a popover dismiss after a resize already persisted the change.)
		committer.commitImageEdit(
			{ paragraphPath: [0], sourceStart: image.start },
			{ alt: image.alt ?? '', url: image.url ?? '' }
		);
		await Promise.resolve();

		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(para.raw).toBe('![alt](url)\n');
	});
});
