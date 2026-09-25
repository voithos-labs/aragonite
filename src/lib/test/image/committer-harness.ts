/**
 * The image-edit committer over one parsed paragraph, with no widget selected, stub events and a
 * spy controller. Shared by every committer suite; registering a syntax handler stays per test.
 */

import { defaultGrammarView } from '$lib/schema/block-openers';
import { vi } from 'vitest';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { imageFieldsFromInline } from '../../components/image/image-source-bytes';
import { getInlineContent } from '../../core/inline/inline-cache';
import { parse } from '../../core/parser';
import { makeStubController } from '../harness/editor-actions';
import type { CstNode, Document, ImageFields } from '../../core/nodes';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import type { WidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { fixtureReading } from '../harness/fixture-grammar';

export interface CommitterHarness {
	committer: ReturnType<typeof createImageEditCommitter>;
	controller: UndoController;
	doc: Document;
	/** The edit target at the paragraph's start that these suites drive. */
	target: { paragraphPath: number[]; sourceStart: number; preSelectOffset: number };
	/** The fields of the image at `target`, as a popover showing it would pass them back. */
	seen: ImageFields;
}

export function committerFor(raw: string): CommitterHarness {
	const doc = parse(raw);
	const controller: UndoController = makeStubController();
	const committer = createImageEditCommitter({
		getDoc: () => doc,
		getEditorEl: () => null,
		widgetSelection: { getSelected: () => null } as unknown as WidgetSelectionState,
		controller,
		events: { emit: vi.fn(), on: vi.fn() } as unknown as EditorEvents,
		reading: fixtureReading()
	});
	const image = getInlineContent(
		doc.children[0] as CstNode,
		undefined,
		undefined,
		defaultGrammarView
	).find((node) => node.kind === 'image' && node.start === 0);
	return {
		committer,
		controller,
		doc,
		target: { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 },
		seen: image ? imageFieldsFromInline(image) : { alt: '', url: '' }
	};
}
