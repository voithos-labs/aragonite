import { describe, it, expect, vi } from 'vitest';
import { createOperationsLog } from '../../debug/operations-log';

describe('operations-log', () => {
	it('records entries in insertion order', () => {
		const log = createOperationsLog(10);
		log.record({ op: 'split', path: [0], detail: { at: 3 } });
		log.record({ op: 'merge', path: [0], detail: { direction: 'prev' } });
		const snap = log.snapshot();
		expect(snap.map((e) => e.op)).toEqual(['split', 'merge']);
	});

	it('evicts oldest entry past capacity', () => {
		const log = createOperationsLog(3);
		for (let i = 0; i < 5; i++) log.record({ op: 'split', path: [i], detail: { at: 0 } });
		const snap = log.snapshot();
		expect(snap).toHaveLength(3);
		expect(snap.map((e) => e.path[0] as number)).toEqual([2, 3, 4]);
	});

	it('stamps each entry with a monotonically increasing timestamp', () => {
		const log = createOperationsLog(10);
		log.record({ op: 'split', path: [0], detail: { at: 0 } });
		log.record({ op: 'split', path: [1], detail: { at: 0 } });
		const snap = log.snapshot();
		expect(snap[1].t).toBeGreaterThanOrEqual(snap[0].t);
	});

	it('notifies subscribers on each record', () => {
		const log = createOperationsLog(10);
		const listener = vi.fn();
		const unsub = log.subscribe(listener);
		log.record({ op: 'split', path: [0], detail: { at: 0 } });
		log.record({ op: 'delete', path: [1], detail: {} });
		expect(listener).toHaveBeenCalledTimes(2);
		unsub();
		log.record({ op: 'split', path: [2], detail: { at: 0 } });
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
