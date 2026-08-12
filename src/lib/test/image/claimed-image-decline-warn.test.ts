// @vitest-environment jsdom
/**
 * The dev diagnostic on a declined image edit: suppressing the commit keeps the author's bytes,
 * and the warn keeps the suppression from being a mystery. The three outcomes are pinned together
 * because the interesting one is a hook returning byte-identical bytes — dropped by the commit's
 * equality guard, warning NOTHING, which is why a hook must decline a field it cannot represent.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { parse } from '../../core/parser';
import { __resetInlineSyntaxForTests } from '../../core/inline/scan/plugin-syntax';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import type { WidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { registerWikiRung, rewriteWikiImage } from './wiki-image-rung';
import { takeDevWarns } from '../support/warn-gate';

const SOURCE = '![[cat.png|300]]\n';
const TARGET = { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 };
const RESIZED = { alt: 'cat.png', url: 'cat.png', width: 320 };

afterEach(() => __resetInlineSyntaxForTests());

function committerFor(raw: string) {
	const doc = parse(raw);
	const controller = {
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(),
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn()
	} as unknown as UndoController;
	const committer = createImageEditCommitter({
		getDoc: () => doc,
		getEditorEl: () => null,
		widgetSelection: { getSelected: () => null } as unknown as WidgetSelectionState,
		controller,
		events: { emit: vi.fn(), on: vi.fn() } as unknown as EditorEvents
	});
	return { committer, controller };
}

const warnings = (): string[] => takeDevWarns().map((w) => `[${w.tag}] ${w.message}`);

describe('a declined image edit says which rung declined and why', () => {
	it('names the rung and the missing hook when none was registered', () => {
		registerWikiRung();
		const { committer, controller } = committerFor(SOURCE);
		committer.commitImageEdit(TARGET, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		const fires = warnings();
		expect(fires).toHaveLength(1);
		expect(fires[0]).toContain('[image-edit]');
		expect(fires[0]).toContain('"![["');
		expect(fires[0]).toContain('registered no rewriteImage hook');
	});

	// The discriminator matters: "you forgot a hook" and "your hook has no form for
	// this edit" send an author to different places.
	it('distinguishes a hook that declined this particular edit', () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller } = committerFor(SOURCE);
		committer.commitImageEdit(TARGET, { ...RESIZED, title: 'Cat' });
		expect(controller.commitStructural).not.toHaveBeenCalled();
		const fires = warnings();
		expect(fires).toHaveLength(1);
		expect(fires[0]).toContain('cannot represent this edit');
	});

	// The quiet failure a consumer hits first: a hook that ignores the edited field returns the
	// source unchanged, so the seam never declines and the equality guard drops it silently.
	it('says nothing when a hook returns the bytes it was given', () => {
		registerWikiRung(() => '![[cat.png|300]]');
		const { committer, controller } = committerFor(SOURCE);
		committer.commitImageEdit(TARGET, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(warnings()).toEqual([]);
	});
});
