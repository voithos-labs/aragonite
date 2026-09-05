// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnyInlineKind, InlineNode } from '$lib/core/nodes';
import { getInlineWidgetEditing } from '$lib/core/inline/inline-widgets';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerEmoji, buildEmojiWidget, EMOJI_KIND } from '$lib/plugins/emoji/emoji-recognizer';

beforeEach(resetPluginPlatformForTests);
afterEach(resetPluginPlatformForTests);

// The decoded-entity mold: a `[data-inline-widget]` island whose text is the glyph
// and whose source bytes ride `data-source-*`, so the raw-aware walk reads `:smile:`
// back while the DOM shows 😄.
describe('buildEmojiWidget — atomic island shell', () => {
	it('stamps the widget marker, source span, and the glyph', () => {
		const node: InlineNode = { kind: EMOJI_KIND as AnyInlineKind, start: 2, end: 9, decoded: '😄' };
		const el = buildEmojiWidget(node);
		expect(el.hasAttribute('data-inline-widget')).toBe(true);
		expect(el.getAttribute('contenteditable')).toBe('false');
		expect(el.dataset.sourceStart).toBe('2');
		expect(el.dataset.sourceEnd).toBe('9');
		expect(el.textContent).toBe('😄');
	});
});

describe('emoji widget registration', () => {
	beforeEach(() => registerEmoji());

	// Atomic delete + step-over is what makes a caret-adjacent Backspace remove the
	// whole reference in one press and a plain arrow walk across it like a character.
	it('registers the atomic, step-over editing policy', () => {
		expect(getInlineWidgetEditing(EMOJI_KIND as AnyInlineKind)).toEqual({
			deleteGranularity: 'atomic',
			onEdge: 'step-over'
		});
	});
});
