// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import type { InlineWidgetEditingContext } from '../../core/inline/inline-widgets';
import { imageWidgetOnSelectedKey } from '../../components/image/image-widget-editing';

function contextFor(
	raw: string,
	inline: InlineNode,
	presentationMode: 'source' | 'reading' = 'source'
) {
	const commit = vi.fn();
	const ctx: InlineWidgetEditingContext = {
		node: { kind: 'paragraph', leadingTrivia: '', raw },
		inline,
		widgetStart: inline.start,
		widgetEnd: inline.end,
		index: 0,
		preSelectOffset: inline.start,
		editorContentWidth: 800,
		presentationMode,
		updateContent: commit
	};
	return { ctx, commit };
}

function shiftArrow(key: 'ArrowLeft' | 'ArrowRight'): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, shiftKey: true });
}

describe('imageWidgetOnSelectedKey — Shift+Arrow keyboard resize', () => {
	it('grows an unsized image by one step from the fallback width', () => {
		const { ctx, commit } = contextFor('![a](x)', {
			kind: 'image',
			start: 0,
			end: 7,
			alt: 'a',
			url: 'x'
		});
		expect(imageWidgetOnSelectedKey(shiftArrow('ArrowRight'), ctx)).toBe(true);
		expect(commit).toHaveBeenCalledWith('![a|420](x)', 0, 11);
	});

	it('holds at the keyboard floor when shrinking a small image', () => {
		const { ctx, commit } = contextFor('![a|40](x)', {
			kind: 'image',
			start: 0,
			end: 10,
			alt: 'a',
			url: 'x',
			width: 40
		});
		expect(imageWidgetOnSelectedKey(shiftArrow('ArrowLeft'), ctx)).toBe(true);
		expect(commit).toHaveBeenCalledWith('![a|32](x)', 0, 10);
	});

	it('scales a locked height alongside the width', () => {
		const { ctx, commit } = contextFor('![a|400x300](x)', {
			kind: 'image',
			start: 0,
			end: 15,
			alt: 'a',
			url: 'x',
			width: 400,
			height: 300
		});
		expect(imageWidgetOnSelectedKey(shiftArrow('ArrowRight'), ctx)).toBe(true);
		expect(commit).toHaveBeenCalledWith('![a|420x315](x)', 0, 15);
	});

	it('preserves the reference form instead of inlining the resolved url', () => {
		const { ctx, commit } = contextFor('![cat|300][shot]', {
			kind: 'image',
			start: 0,
			end: 16,
			alt: 'cat',
			url: 'resolved.png',
			width: 300,
			label: 'shot'
		});
		expect(imageWidgetOnSelectedKey(shiftArrow('ArrowRight'), ctx)).toBe(true);
		expect(commit).toHaveBeenCalledWith('![cat|320][shot]', 0, 16);
	});

	it('declines in reading mode and commits nothing', () => {
		const { ctx, commit } = contextFor(
			'![a](x)',
			{ kind: 'image', start: 0, end: 7, alt: 'a', url: 'x' },
			'reading'
		);
		expect(imageWidgetOnSelectedKey(shiftArrow('ArrowRight'), ctx)).toBe(false);
		expect(commit).not.toHaveBeenCalled();
	});

	it('ignores a key without Shift and commits nothing', () => {
		const { ctx, commit } = contextFor('![a](x)', {
			kind: 'image',
			start: 0,
			end: 7,
			alt: 'a',
			url: 'x'
		});
		expect(imageWidgetOnSelectedKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }), ctx)).toBe(
			false
		);
		expect(commit).not.toHaveBeenCalled();
	});
});
