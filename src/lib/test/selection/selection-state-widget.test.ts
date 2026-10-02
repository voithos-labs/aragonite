// The widget the selection state holds: what it stores, where it reports the caret, and when it
// tells subscribers.
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import type { WidgetTarget } from '../../selection/primitives';

const IMAGE: WidgetTarget = { paragraphPath: [0, 1], sourceStart: 12, preSelectOffset: 12 };

function recording(widgetSpan?: (t: WidgetTarget) => { start: number; end: number } | null) {
	let notified = 0;
	const selection = createSelectionState({ onChange: () => notified++, widgetSpan });
	return { selection, notified: () => notified };
}

describe('SelectionState: a widget selected whole', () => {
	it('stores a copy, so neither the caller nor a reader writes through', () => {
		const { selection } = recording();
		const target = { ...IMAGE, paragraphPath: [0, 1] };

		selection.selectWidget(target);
		target.paragraphPath.push(99);
		selection.widget!.paragraphPath.push(98);

		expect(selection.widget).toEqual(IMAGE);
	});

	it('replaces a previously selected widget', () => {
		const { selection } = recording();

		selection.selectWidget(IMAGE);
		selection.selectWidget({ paragraphPath: [1], sourceStart: 0, preSelectOffset: 0 });

		expect(selection.widget).toEqual({ paragraphPath: [1], sourceStart: 0, preSelectOffset: 0 });
	});

	it('announces each select, and stays silent when a clear ends only the widget', () => {
		const h = recording();

		h.selection.selectWidget(IMAGE);
		h.selection.selectWidget(IMAGE);
		expect(h.notified()).toBe(2);

		h.selection.clear();
		h.selection.collapse();
		expect(h.selection.widget).toBeNull();
		expect(h.notified()).toBe(2);
	});

	it('collapse and the document swap drop it too', () => {
		const { selection } = recording();
		selection.selectWidget(IMAGE);
		selection.collapse();
		expect(selection.widget).toBeNull();

		selection.selectWidget(IMAGE);
		selection.dropForDocumentSwap();
		expect(selection.widget).toBeNull();
	});

	it('follows an edit at or before it in its own block, silently, and nothing else', () => {
		const h = recording();
		h.selection.selectWidget({ paragraphPath: [0], sourceStart: 12, preSelectOffset: 23 });
		const before = h.notified();

		h.selection.followWidgetEdit([1], 0, 7);
		h.selection.followWidgetEdit([0], 13, 7);
		expect(h.selection.widget).toEqual({
			paragraphPath: [0],
			sourceStart: 12,
			preSelectOffset: 23
		});

		h.selection.followWidgetEdit([0], 12, 7);
		expect(h.selection.widget).toEqual({
			paragraphPath: [0],
			sourceStart: 19,
			preSelectOffset: 30
		});
		expect(h.notified()).toBe(before);
	});

	it('reports the caret at the live edge it was entered from', () => {
		const span = { start: 12, end: 30 };
		const { selection } = recording(() => span);

		selection.selectWidget(IMAGE);
		expect(selection.widgetCaret()).toEqual({ path: [0, 1], offset: 12 });

		selection.selectWidget({ ...IMAGE, preSelectOffset: 25 });
		expect(selection.widgetCaret()).toEqual({ path: [0, 1], offset: 30 });
		expect(selection.widgetRange()).toEqual({ path: [0, 1], start: 12, end: 30 });
	});

	it('reports the offset it was entered at, and no range, once no widget starts there', () => {
		const { selection } = recording(() => null);

		selection.selectWidget({ ...IMAGE, preSelectOffset: 25 });

		expect(selection.widgetRange()).toBeNull();
		expect(selection.widgetCaret()).toEqual({ path: [0, 1], offset: 25 });
	});
});
