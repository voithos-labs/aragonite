// @vitest-environment jsdom
//
// Miss-analysis: every selected-widget key case at this level was a modifier chord or an edit
// key, and the e2e arrow specs walked PAST an image with a caret beside it, never from a
// selected one, so the swallow-everything tail ate the vertical arrows unnoticed.
import { describe, it, expect } from 'vitest';
import { harness } from './widget-selected-fixture';

function arrow(key: 'ArrowUp' | 'ArrowDown', shiftKey = false): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, shiftKey, cancelable: true });
}

// The widget spans [0, 7); the tail keeps the paragraph from being image-only.
function selectedImage() {
	const seats: number[] = [];
	const h = harness('![a](x) tail\n', 0, undefined, {
		cursor: { setRaw: (offset: number) => seats.push(offset) } as never
	});
	return { ...h, seats };
}

describe('handleSelectedWidgetKeydown — a plain vertical arrow leaves the widget', () => {
	it('ArrowDown seats the caret after the widget, clears the selection and declines', async () => {
		const { interaction, widgetSelection, seats } = selectedImage();
		const e = arrow('ArrowDown');
		expect(await interaction.handleSelectedWidgetKeydown(e)).toBe(false);
		expect(seats).toEqual([7]);
		expect(widgetSelection.getSelected()).toBeNull();
		// The shared pipeline's line walk runs next and owns the default.
		expect(e.defaultPrevented).toBe(false);
	});

	it('ArrowUp seats the caret before the widget', async () => {
		const { interaction, widgetSelection, seats } = selectedImage();
		expect(await interaction.handleSelectedWidgetKeydown(arrow('ArrowUp'))).toBe(false);
		expect(seats).toEqual([0]);
		expect(widgetSelection.getSelected()).toBeNull();
	});

	it('Shift+ArrowDown stays swallowed with the widget still selected', async () => {
		const { interaction, widgetSelection, seats } = selectedImage();
		const e = arrow('ArrowDown', true);
		expect(await interaction.handleSelectedWidgetKeydown(e)).toBe(true);
		expect(seats).toEqual([]);
		expect(widgetSelection.getSelected()).not.toBeNull();
		expect(e.defaultPrevented).toBe(true);
	});
});
