// @vitest-environment jsdom
/**
 * Editing an image whose bytes a plugin inline rung claimed: the hook writes them,
 * or nothing does. Both entry points are driven, because each carried the GFM
 * serializer independently before the seam existed. Contract:
 * docs/design/plugin-contract.md § Inline authoring.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { imageWidgetOnSelectedKey } from '../../components/image/image-widget-editing';
import { parse } from '../../core/parser';
import { getInlineContent } from '../../core/inline/inline-cache';
import { __resetInlineSyntaxForTests } from '../../core/inline/scan/plugin-syntax';
import type { InlineWidgetEditingContext } from '../../core/inline/inline-widgets';
import type { CstNode, InlineNode } from '../../core/nodes';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import type { WidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { registerWikiRung, rewriteWikiImage } from './wiki-image-rung';

afterEach(() => __resetInlineSyntaxForTests());

function firstImage(raw: string): { paragraph: CstNode; image: InlineNode } {
	const doc = parse(raw);
	const paragraph = doc.children[0] as CstNode;
	const image = getInlineContent(paragraph).find((node) => node.kind === 'image');
	if (!image) throw new Error(`no image parsed out of ${JSON.stringify(raw)}`);
	return { paragraph, image };
}

function keyboardResize(raw: string): { consumed: boolean; commit: ReturnType<typeof vi.fn> } {
	const { paragraph, image } = firstImage(raw);
	const commit = vi.fn();
	const ctx: InlineWidgetEditingContext = {
		node: paragraph,
		inline: image,
		widgetStart: image.start,
		widgetEnd: image.end,
		index: 0,
		preSelectOffset: image.start,
		editorContentWidth: 800,
		presentationMode: 'source',
		updateContent: commit
	};
	const consumed = imageWidgetOnSelectedKey(
		new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }),
		ctx
	);
	return { consumed, commit };
}

describe('Shift+Arrow resize of an image a rung claimed', () => {
	it('re-emits the rung’s own syntax when it registered a rewrite hook', () => {
		registerWikiRung(rewriteWikiImage);
		const { consumed, commit } = keyboardResize('![[cat.png|300]]\n');
		expect(consumed).toBe(true);
		expect(commit).toHaveBeenCalledWith('![[cat.png|320]]\n', 0, 16);
	});

	// The defect this suite exists for: the bytes used to come back
	// `![cat.png|320](cat.png)`, silently replacing the consumer's grammar.
	it('commits nothing when the rung registered no hook', () => {
		registerWikiRung();
		const { consumed, commit } = keyboardResize('![[cat.png|300]]\n');
		expect(commit).not.toHaveBeenCalled();
		// The gesture was the widget's; handing the arrow on would move the caret
		// out of a widget the user is still resizing.
		expect(consumed).toBe(true);
	});

	it('commits nothing when the hook declines the edit', () => {
		registerWikiRung(() => null);
		const { commit } = keyboardResize('![[cat.png|300]]\n');
		expect(commit).not.toHaveBeenCalled();
	});

	it('leaves a GFM image resizing as GFM while the rung is registered', () => {
		registerWikiRung(rewriteWikiImage);
		const { consumed, commit } = keyboardResize('![a](x)\n');
		expect(consumed).toBe(true);
		expect(commit).toHaveBeenCalledWith('![a|420](x)\n', 0, 11);
	});

	// `![[a]](u)` is a built-in image whose alt text is `[a]`: the rung declines it,
	// so nothing claimed those bytes and the GFM write path still owns them. A
	// detection that keyed on the `![[` prefix rather than on the claim would
	// wrongly decline this resize.
	it('resizes the image the rung declined', () => {
		registerWikiRung(rewriteWikiImage);
		const { consumed, commit } = keyboardResize('![[a]](u)\n');
		expect(consumed).toBe(true);
		expect(commit).toHaveBeenCalledWith('![\\[a\\]|420](u)\n', 0, 15);
	});
});

// ── The drag-resize / properties-popover commit path ─────────────────────────

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
	return {
		committer,
		controller,
		target: { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 }
	};
}

describe('a popover or drag commit on an image a rung claimed', () => {
	it('builds the rung’s bytes and commits them', async () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target } = committerFor('![[cat.png|300]]\n');
		const resized = { alt: 'cat.png', url: 'cat.png', width: 320 };
		expect(committer.buildEditBytes(target, resized)).toBe('![[cat.png|320]]');
		committer.commitImageEdit(target, resized);
		await Promise.resolve();
		expect(controller.commitStructural).toHaveBeenCalled();
	});

	it('declines the commit outright when the rung registered no hook', async () => {
		registerWikiRung();
		const { committer, controller, target } = committerFor('![[cat.png|300]]\n');
		const resized = { alt: 'cat.png', url: 'cat.png', width: 320 };
		expect(committer.buildEditBytes(target, resized)).toBeNull();
		committer.commitImageEdit(target, resized);
		await Promise.resolve();
		expect(controller.commitStructural).not.toHaveBeenCalled();
	});

	// The decline a consumer meets first. An embed names one file, so the popover's
	// Alt row edits a field the grammar cannot store apart from the target; a hook
	// that ignored it would return byte-identical bytes and the commit's equality
	// guard would drop them, leaving the row inert with no diagnostic anywhere.
	it('declines an alt edited away from the target', async () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target } = committerFor('![[cat.png|300]]\n');
		const renamed = { alt: 'A cat', url: 'cat.png', width: 300 };
		expect(committer.buildEditBytes(target, renamed)).toBeNull();
		committer.commitImageEdit(target, renamed);
		await Promise.resolve();
		expect(controller.commitStructural).not.toHaveBeenCalled();
	});

	// A hook may model only part of its own grammar's edits — the embed syntax has
	// nowhere to put a title — and a decline there is a decline, not a fallback.
	it('declines an edit the hook cannot represent', async () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target } = committerFor('![[cat.png|300]]\n');
		const titled = { alt: 'cat.png', url: 'cat.png', width: 300, title: 'Cat' };
		expect(committer.buildEditBytes(target, titled)).toBeNull();
		committer.commitImageEdit(target, titled);
		await Promise.resolve();
		expect(controller.commitStructural).not.toHaveBeenCalled();
	});
});
