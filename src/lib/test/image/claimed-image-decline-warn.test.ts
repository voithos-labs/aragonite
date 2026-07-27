// @vitest-environment jsdom
/**
 * The dev diagnostic on a declined image edit. Suppressing the commit is what keeps
 * the author's bytes; the warn is what keeps the suppression from being a mystery —
 * an affordance that visibly does nothing is the bottom rung of the ladder without
 * it. So the three outcomes are pinned together, because the interesting one is the
 * third: a hook that returns bytes identical to the source is dropped by the commit's
 * equality guard and warns NOTHING, which is why a hook must decline a field it
 * cannot represent rather than ignore it.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { parse } from '../../core/parser';
import { configureEditorEnv, resetEditorEnv } from '../../env';
import { __resetInlineSyntaxForTests } from '../../core/inline/scan/plugin-syntax';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import type { WidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { registerWikiRung, rewriteWikiImage } from './wiki-image-rung';

const SOURCE = '![[cat.png|300]]\n';
const TARGET = { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 };
const RESIZED = { alt: 'cat.png', url: 'cat.png', width: 320 };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	// devWarn is inert under VITEST by design, so the diagnostic can only be
	// observed by standing in for a dev build.
	configureEditorEnv({ isDev: true, isTest: false });
});

afterEach(() => {
	warnSpy.mockRestore();
	resetEditorEnv();
	__resetInlineSyntaxForTests();
});

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

const warnings = (): string[] => warnSpy.mock.calls.map((call: unknown[]) => String(call[0]));

describe('a declined image edit says which rung declined and why', () => {
	it('names the rung and the missing hook when none was registered', () => {
		registerWikiRung();
		const { committer, controller } = committerFor(SOURCE);
		committer.commitImageEdit(TARGET, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(warnings()).toHaveLength(1);
		expect(warnings()[0]).toContain('[image-edit]');
		expect(warnings()[0]).toContain('"![["');
		expect(warnings()[0]).toContain('registered no rewriteImage hook');
	});

	// The discriminator matters: "you forgot a hook" and "your hook has no form for
	// this edit" send an author to different places.
	it('distinguishes a hook that declined this particular edit', () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller } = committerFor(SOURCE);
		committer.commitImageEdit(TARGET, { ...RESIZED, title: 'Cat' });
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(warnings()).toHaveLength(1);
		expect(warnings()[0]).toContain('cannot represent this edit');
	});

	// The quiet failure a consumer hits first: a hook that ignores the field the user
	// edited returns the source unchanged, so the seam never declines and the commit's
	// equality guard drops it with nothing to read anywhere.
	it('says nothing when a hook returns the bytes it was given', () => {
		registerWikiRung(() => '![[cat.png|300]]');
		const { committer, controller } = committerFor(SOURCE);
		committer.commitImageEdit(TARGET, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(warnings()).toEqual([]);
	});
});
