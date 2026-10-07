// @vitest-environment jsdom
// A selected widget leaves vertical arrows, Home, End and the page keys to the shared caret move.
// Miss-analysis: key cases were chords or edit keys, and e2e never stepped from a selected image.
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
		const { interaction, selection, carets } = selectedImage();
		const e = press(key);
		expect(await interaction.handleSelectedWidgetKeydown(e)).toBe(false);
		expect(carets).toEqual([edge]);
		expect(selection.widget).toBeNull();
		// The shared move runs next, from that caret, and owns the default.
		expect(e.defaultPrevented).toBe(false);
	});

	it('Shift+ArrowDown stays swallowed with the widget still selected', async () => {
		const { interaction, selection, carets } = selectedImage();
		const e = press('ArrowDown', true);
		expect(await interaction.handleSelectedWidgetKeydown(e)).toBe(true);
		expect(carets).toEqual([]);
		expect(selection.widget).not.toBeNull();
		expect(e.defaultPrevented).toBe(true);
	});
});
