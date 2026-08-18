/**
 * The image-edit committer over one parsed paragraph — null widget selection, stub events, spy
 * controller — shared by every committer suite; rung registration stays per test.
 */

import { vi } from 'vitest';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { parse } from '../../core/parser';
import { makeStubController } from '../harness/editor-actions';
import type { Document } from '../../core/nodes';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import type { WidgetSelectionState } from '../../components/image/widget-selection-state.svelte';

export interface CommitterHarness {
	committer: ReturnType<typeof createImageEditCommitter>;
	controller: UndoController;
	doc: Document;
	/** The paragraph-start edit target the claimed-image suites drive. */
	target: { paragraphPath: number[]; sourceStart: number; preSelectOffset: number };
}

export function committerFor(raw: string): CommitterHarness {
	const doc = parse(raw);
	const controller: UndoController = makeStubController();
	const committer = createImageEditCommitter({
		getDoc: () => doc,
		getEditorEl: () => null,
		widgetSelection: { getSelected: () => null } as unknown as WidgetSelectionState,
		controller,
		events: { emit: vi.fn(), on: vi.fn() } as unknown as EditorEvents
	});
	return {
		committer,
		controller,
		doc,
		target: { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 }
	};
}
