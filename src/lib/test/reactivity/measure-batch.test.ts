import { describe, it, expect, vi } from 'vitest';
import { runMeasureBatch, type MeasureEntry } from '../../reactivity/measure-batch';

// VR-4: every mounted block's height is read BEFORE any height is written, because a
// read after a write hits a layout that write dirtied — one forced synchronous reflow
// per block on a fling.

/** Records every read/write as a tagged event on a shared timeline so a test can
 *  assert all reads precede all writes regardless of how many entries there are. */
function tracedEntry(id: string, height: number, log: string[]): MeasureEntry {
	return {
		readHeight: () => {
			log.push(`read:${id}`);
			return height;
		},
		applyHeight: () => log.push(`write:${id}`)
	};
}

describe('runMeasureBatch', () => {
	it('reads every entry before it writes any entry', () => {
		const log: string[] = [];
		const entries = [
			tracedEntry('a', 10, log),
			tracedEntry('b', 20, log),
			tracedEntry('c', 30, log)
		];

		runMeasureBatch(entries);

		expect(log).toEqual(['read:a', 'read:b', 'read:c', 'write:a', 'write:b', 'write:c']);
		const lastRead = log.lastIndexOf('read:c');
		const firstWrite = log.indexOf('write:a');
		expect(lastRead).toBeLessThan(firstWrite);
	});

	it('applies each measured height to its own entry', () => {
		const writeA = vi.fn();
		const writeB = vi.fn();
		runMeasureBatch([
			{ readHeight: () => 42, applyHeight: writeA },
			{ readHeight: () => 99, applyHeight: writeB }
		]);
		expect(writeA).toHaveBeenCalledWith(42);
		expect(writeB).toHaveBeenCalledWith(99);
	});

	// jsdom (and a not-yet-laid-out element) reports 0 — recording it would clobber a
	// good estimate with zero. The read still happens, so the phase split is unaffected.
	it('skips the write for a non-positive height but still reads it', () => {
		const log: string[] = [];
		const apply = vi.fn();
		runMeasureBatch([
			{
				readHeight: () => {
					log.push('read');
					return 0;
				},
				applyHeight: apply
			}
		]);
		expect(log).toEqual(['read']);
		expect(apply).not.toHaveBeenCalled();
	});

	it('does nothing for an empty batch', () => {
		expect(() => runMeasureBatch([])).not.toThrow();
	});
});
