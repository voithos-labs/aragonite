// @vitest-environment jsdom
//
// Miss-analysis: every selected-widget key case here was a modifier chord or an edit key, and
// the e2e arrow specs stepped past an image with a caret beside it, never from a selected one,
// so the catch-all consume at the end ate the vertical arrows, Home, End and the page keys.
import { describe, it, expect } from 'vitest';
import { harness } from './widget-selected-fixture';

function press(key: string, shiftKey = false): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, shiftKey, cancelable: true });
}

// The widget spans [0, 7); the tail keeps the paragraph from being image-only.
function selectedImage() {
	const carets: number[] = [];
	const h = harness('![a](x) tail\n', 0, undefined, {
		cursor: { setRaw: (offset: number) => carets.push(offset) } as never
	});
	return { ...h, carets };
}

describe('handleSelectedWidgetKeydown: a plain caret-moving key leaves the widget', () => {
	it.each([
		['ArrowUp', 0],
		['Home', 0],
		['PageUp', 0],
		['ArrowDown', 7],
		['End', 7],
		['PageDown', 7]
	])('%s puts the caret at offset %i, clears the selection and declines', async (key, edge) => {
		const { interaction, widgetSelection, carets } = selectedImage();
		const e = press(key);
		expect(await interaction.handleSelectedWidgetKeydown(e)).toBe(false);
		expect(carets).toEqual([edge]);
		expect(widgetSelection.getSelected()).toBeNull();
		// The shared move runs next, from that caret, and owns the default.
		expect(e.defaultPrevented).toBe(false);
	});

	it('Shift+ArrowDown stays swallowed with the widget still selected', async () => {
		const { interaction, widgetSelection, carets } = selectedImage();
		const e = press('ArrowDown', true);
		expect(await interaction.handleSelectedWidgetKeydown(e)).toBe(true);
		expect(carets).toEqual([]);
		expect(widgetSelection.getSelected()).not.toBeNull();
		expect(e.defaultPrevented).toBe(true);
	});
});
