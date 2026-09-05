import { describe, it, expect, vi } from 'vitest';
import { buildTaskItemAmbient } from '$lib/components/blocks/list/task-checkbox';
import type { ListItemMetadata } from '$lib/core/nodes';
import { takeDevWarns } from '../../support/warn-gate';

function plainListMeta(): ListItemMetadata {
	return { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null };
}

function taskMeta(overrides: Partial<ListItemMetadata> = {}): ListItemMetadata {
	return {
		marker: '- ',
		taskItem: true,
		taskChecked: false,
		taskMarker: '[ ] ',
		...overrides
	};
}

describe('buildTaskItemAmbient', () => {
	it('returns the plain marker string for a non-task item', () => {
		const result = buildTaskItemAmbient(plainListMeta(), vi.fn());
		expect(result).toBe('- ');
	});

	it('falls back to "- " when metadata is absent', () => {
		const result = buildTaskItemAmbient(undefined, vi.fn());
		expect(result).toBe('- ');
	});

	it('builds a checkbox interactive range for a canonical task item', () => {
		const onToggle = vi.fn();
		const result = buildTaskItemAmbient(
			taskMeta({ taskChecked: true, taskMarker: '[x] ' }),
			onToggle
		);
		expect(result).toEqual({
			text: '- [x] ',
			interactive: [
				{
					start: 2,
					end: 5,
					className: 'task-checkbox',
					role: 'checkbox',
					ariaChecked: true,
					onClick: onToggle
				}
			]
		});
	});

	it('keeps non-canonical [X] in text and keeps box width at 3', () => {
		const result = buildTaskItemAmbient(taskMeta({ taskMarker: '[X] ' }), vi.fn());
		expect(typeof result).toBe('object');
		if (typeof result === 'string') return;
		expect(result.text).toBe('- [X] ');
		const range = result.interactive?.[0];
		expect(range).toBeDefined();
		expect(range!.end - range!.start).toBe(3);
		expect(result.text.slice(range!.start, range!.end)).toBe('[X]');
	});

	it('degrades to plain marker when taskItem flag and taskMarker disagree', () => {
		const result = buildTaskItemAmbient(
			{ marker: '- ', taskItem: true, taskChecked: false, taskMarker: null },
			vi.fn()
		);
		expect(result).toBe('- ');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['ListItemBlock']);
	});

	it('preserves a non-default list marker (e.g. ordered "1. ")', () => {
		const result = buildTaskItemAmbient(
			taskMeta({ marker: '1. ', taskMarker: '[x] ', taskChecked: true }),
			vi.fn()
		);
		if (typeof result === 'string') throw new Error('expected object');
		expect(result.text).toBe('1. [x] ');
		expect(result.interactive?.[0].start).toBe(3);
		expect(result.interactive?.[0].end).toBe(6);
	});

	it.each([
		['[x] ', true],
		['[ ] ', false],
		['[X] ', true]
	])('derives ariaChecked from the marker %s', (taskMarker, expected) => {
		const result = buildTaskItemAmbient(taskMeta({ taskMarker }), vi.fn());
		if (typeof result === 'string') throw new Error('expected object');
		expect(result.interactive?.[0].ariaChecked).toBe(expected);
	});

	// Desync-proofing: ariaChecked follows the keyed marker, never the parallel taskChecked field.
	it('ignores a stale taskChecked when the marker says checked', () => {
		const result = buildTaskItemAmbient(
			taskMeta({ taskMarker: '[x] ', taskChecked: false }),
			vi.fn()
		);
		if (typeof result === 'string') throw new Error('expected object');
		expect(result.interactive?.[0].ariaChecked).toBe(true);
	});

	it('ignores a stale taskChecked when the marker says unchecked', () => {
		const result = buildTaskItemAmbient(
			taskMeta({ taskMarker: '[ ] ', taskChecked: true }),
			vi.fn()
		);
		if (typeof result === 'string') throw new Error('expected object');
		expect(result.interactive?.[0].ariaChecked).toBe(false);
	});
});
