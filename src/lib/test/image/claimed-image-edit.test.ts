// @vitest-environment jsdom
/**
 * Editing an image whose bytes a plugin's inline syntax handler owns: its hook writes them, or
 * nothing does. Both entry points are driven, since each called the GFM serializer on its own
 * before they shared one path. Contract: docs/design/plugin-contract.md § Inline authoring.
 */

import { defaultGrammarView } from '$lib/schema/block-openers';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { imageWidgetOnSelectedKey } from '../../components/image/image-widget-editing';
import { parse } from '../../core/parser';
import { getInlineContent } from '../../core/inline/inline-cache';
import type { InlineWidgetEditingContext } from '../../core/inline/inline-widgets';
import type { CstNode, InlineNode } from '../../core/nodes';
import { committerFor } from './committer-harness';
import { registerWikiRung, rewriteWikiImage } from './wiki-image-rung';
import { takeDevWarns } from '../support/warn-gate';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

afterEach(() => __resetSchemaRegistriesForTests());

function firstImage(raw: string): { paragraph: CstNode; image: InlineNode } {
	const doc = parse(raw);
	const paragraph = doc.children[0] as CstNode;
	const image = getInlineContent(paragraph, undefined, undefined, defaultGrammarView).find(
		(node) => node.kind === 'image'
	);
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

describe('Shift+Arrow resize of an image an inline syntax handler claimed', () => {
	it('re-emits the inline syntax handler’s own syntax when it registered a rewrite hook', () => {
		registerWikiRung(rewriteWikiImage);
		const { consumed, commit } = keyboardResize('![[cat.png|300]]\n');
		expect(consumed).toBe(true);
		expect(commit).toHaveBeenCalledWith('![[cat.png|320]]\n', 0, 16);
	});

	// A GFM fallback here would come back `![cat.png|320](cat.png)`, silently
	// replacing the consumer's grammar.
	it('commits nothing when the inline syntax handler registered no hook', () => {
		registerWikiRung();
		const { consumed, commit } = keyboardResize('![[cat.png|300]]\n');
		expect(commit).not.toHaveBeenCalled();
		// The gesture was the widget's; passing the arrow on would move the caret
		// out of a widget the user is still resizing.
		expect(consumed).toBe(true);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['image-edit']);
	});

	it('commits nothing when the hook declines the edit', () => {
		registerWikiRung(() => null);
		const { commit } = keyboardResize('![[cat.png|300]]\n');
		expect(commit).not.toHaveBeenCalled();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['image-edit']);
	});

	it('leaves a GFM image resizing as GFM while the inline syntax handler is registered', () => {
		registerWikiRung(rewriteWikiImage);
		const { consumed, commit } = keyboardResize('![a](x)\n');
		expect(consumed).toBe(true);
		expect(commit).toHaveBeenCalledWith('![a|420](x)\n', 0, 11);
	});

	// `![[a]](u)` is a built-in image whose alt text is `[a]`: the plugin's handler refuses it, so
	// the GFM write path still owns those bytes; a test on the `![[` prefix alone would not.
	it('resizes the image the inline syntax handler declined', () => {
		registerWikiRung(rewriteWikiImage);
		const { consumed, commit } = keyboardResize('![[a]](u)\n');
		expect(consumed).toBe(true);
		expect(commit).toHaveBeenCalledWith('![\\[a\\]|420](u)\n', 0, 15);
	});
});

// ── The drag-resize and properties-popover commit path ───────────────────────

describe('a popover or drag commit on an image an inline syntax handler claimed', () => {
	it('builds the inline syntax handler’s bytes and commits them', async () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target, seen } = committerFor('![[cat.png|300]]\n');
		const resized = { alt: 'cat.png', url: 'cat.png', width: 320 };
		expect(committer.buildEditBytes(target, resized)).toBe('![[cat.png|320]]');
		committer.commitImageEdit(target, seen, resized);
		await Promise.resolve();
		expect(controller.commitStructural).toHaveBeenCalled();
	});

	it('declines the commit outright when the inline syntax handler registered no hook', async () => {
		registerWikiRung();
		const { committer, controller, target, seen } = committerFor('![[cat.png|300]]\n');
		const resized = { alt: 'cat.png', url: 'cat.png', width: 320 };
		expect(committer.buildEditBytes(target, resized)).toBeNull();
		committer.commitImageEdit(target, seen, resized);
		await Promise.resolve();
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['image-edit', 'image-edit']);
	});

	// The refusal a consumer meets first: an embed names one file, so the popover's Alt row edits
	// a field the grammar cannot store, and a hook that ignored it would return the same bytes.
	it('declines an alt edited away from the target', async () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target, seen } = committerFor('![[cat.png|300]]\n');
		const renamed = { alt: 'A cat', url: 'cat.png', width: 300 };
		expect(committer.buildEditBytes(target, renamed)).toBeNull();
		committer.commitImageEdit(target, seen, renamed);
		await Promise.resolve();
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['image-edit', 'image-edit']);
	});

	// A hook may cover only part of its own grammar's edits (the embed syntax has
	// nowhere to put a title), and a refusal there is a refusal, not a fallback.
	it('declines an edit the hook cannot represent', async () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target, seen } = committerFor('![[cat.png|300]]\n');
		const titled = { alt: 'cat.png', url: 'cat.png', width: 300, title: 'Cat' };
		expect(committer.buildEditBytes(target, titled)).toBeNull();
		committer.commitImageEdit(target, seen, titled);
		await Promise.resolve();
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['image-edit', 'image-edit']);
	});
});
