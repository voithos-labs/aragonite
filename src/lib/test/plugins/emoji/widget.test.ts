// @vitest-environment jsdom
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '#lib';
import {
	getInlineWidgetEditing,
	type InlineWidgetComponentProps
} from '#lib/core/inline/inline-widgets.js';
import { mintWidgetShell } from '#lib/core/inline/widget-shell.js';
import { registerEmoji, drawEmoji, EMOJI_KIND } from '#packages/emoji/src/emoji-recognizer.js';

// The glyph is what the widget shows; the shell the editor hands it keeps the source bytes on
// `data-source-*`, so the DOM-to-offset traversal reads `:smile:` back while the DOM shows 😄.
describe('drawEmoji: the glyph in its shell', () => {
	it('draws the glyph, unselectable, without touching the source range', () => {
		const node: InlineNode = {
			kind: EMOJI_KIND as InlineNode['kind'],
			start: 2,
			end: 9,
			decoded: '😄'
		};
		const shell = mintWidgetShell(node);
		drawEmoji(shell, { inline: node } as InlineWidgetComponentProps);
		expect(shell.textContent).toBe('😄');
		expect(shell.classList.contains('md-emoji-widget')).toBe(true);
		expect(shell.style.userSelect).toBe('none');
		expect(shell.dataset.sourceStart).toBe('2');
		expect(shell.dataset.sourceEnd).toBe('9');
	});
});

describe('emoji widget registration', () => {
	beforeEach(() => registerEmoji());

	// Atomic delete plus step-over is what makes a Backspace beside it remove the whole
	// shortcode at once and a plain arrow move across it as if it were one character.
	it('registers the atomic, step-over editing policy', () => {
		expect(getInlineWidgetEditing(EMOJI_KIND as InlineNode['kind'], defaultGrammarView)).toEqual({
			deleteGranularity: 'atomic',
			onEdge: 'step-over'
		});
	});
});
