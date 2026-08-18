import { describe, it, expect, vi } from 'vitest';
import { createWidgetSelectionState } from '../../components/image/widget-selection-state.svelte';

describe('WidgetSelectionState', () => {
	it('clear resets to null', () => {
		const s = createWidgetSelectionState({ onSelect: () => {} });
		s.select({ paragraphPath: [0], sourceStart: 5, preSelectOffset: 5 });
		s.clear();
		expect(s.getSelected()).toBeNull();
	});

	it('selecting a different widget replaces the previous selection', () => {
		const s = createWidgetSelectionState({ onSelect: () => {} });
		s.select({ paragraphPath: [0], sourceStart: 5, preSelectOffset: 5 });
		s.select({ paragraphPath: [1], sourceStart: 0, preSelectOffset: 0 });
		expect(s.getSelected()).toEqual({
			paragraphPath: [1],
			sourceStart: 0,
			preSelectOffset: 0
		});
	});

	it('selecting fires onSelect callback once per call', () => {
		const onSelect = vi.fn();
		const s = createWidgetSelectionState({ onSelect });
		s.select({ paragraphPath: [0], sourceStart: 5, preSelectOffset: 5 });
		expect(onSelect).toHaveBeenCalledTimes(1);
		s.select({ paragraphPath: [1], sourceStart: 0, preSelectOffset: 0 });
		expect(onSelect).toHaveBeenCalledTimes(2);
	});

	it('clear does not fire onSelect', () => {
		const onSelect = vi.fn();
		const s = createWidgetSelectionState({ onSelect });
		s.select({ paragraphPath: [0], sourceStart: 5, preSelectOffset: 5 });
		onSelect.mockClear();
		s.clear();
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('isSelected returns true for the matching path+start', () => {
		const s = createWidgetSelectionState({ onSelect: () => {} });
		s.select({ paragraphPath: [0, 1], sourceStart: 12, preSelectOffset: 12 });
		expect(s.isSelected([0, 1], 12)).toBe(true);
		expect(s.isSelected([0, 1], 13)).toBe(false);
		expect(s.isSelected([0, 2], 12)).toBe(false);
		expect(s.isSelected([0], 12)).toBe(false);
		expect(s.isSelected([0, 1, 0], 12)).toBe(false);
	});

	it('isSelected returns false when nothing is selected', () => {
		const s = createWidgetSelectionState({ onSelect: () => {} });
		expect(s.isSelected([0], 0)).toBe(false);
	});

	it('select clones paragraphPath (caller mutation does not leak)', () => {
		const s = createWidgetSelectionState({ onSelect: () => {} });
		const path = [0, 1];
		s.select({ paragraphPath: path, sourceStart: 5, preSelectOffset: 5 });
		path.push(99);
		expect(s.getSelected()?.paragraphPath).toEqual([0, 1]);
	});

	it('select preserves preSelectOffset distinct from sourceStart', () => {
		const s = createWidgetSelectionState({ onSelect: () => {} });
		s.select({ paragraphPath: [0], sourceStart: 10, preSelectOffset: 22 });
		expect(s.getSelected()?.preSelectOffset).toBe(22);
	});
});
