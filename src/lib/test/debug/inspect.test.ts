import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { createOperationsLog } from '../../debug/operations-log';
import {
	dumpSelection,
	dumpUndoStack,
	dumpInlineTree,
	dumpOperationsLog
} from '../../debug/inspect';
import { parseInline, getContentRange } from '../../core/inline';
import type { SelectionState } from '../../selection/selection-state.svelte';
import type { UndoEntry } from '../../contracts';

describe('dumpSelection', () => {
	it('renders a single-block selection as one line with matching anchor/focus', () => {
		const state = {
			anchor: { path: [1, 0, 3], offset: 5 },
			focus: { path: [1, 0, 3], offset: 5 },
			isCrossBlock: false,
			start: null,
			end: null
		} as unknown as SelectionState;
		expect(dumpSelection(state)).toBe('anchor=[1,0,3]@5 focus=[1,0,3]@5 cross-block=false');
	});

	it('renders a cross-block selection with start/end', () => {
		const state = {
			anchor: { path: [1], offset: 3 },
			focus: { path: [3, 0], offset: 0 },
			isCrossBlock: true,
			start: { path: [1], offset: 3 },
			end: { path: [3, 0], offset: 0 }
		} as unknown as SelectionState;
		const out = dumpSelection(state);
		expect(out).toContain('cross-block=true');
		expect(out).toContain('start=[1]@3');
		expect(out).toContain('end=[3,0]@0');
	});

	it('renders a null selection', () => {
		expect(dumpSelection(null)).toBe('(no selection)');
	});
});

describe('dumpUndoStack', () => {
	const now = Date.now();
	const mkEntry = (kind: 'structural' | 'input-batch', offset: number): UndoEntry =>
		({
			snapshot: { kind: 'document', children: [], raw: '' },
			blockIds: [],
			selection: {
				anchor: { path: [0], offset },
				focus: { path: [0], offset }
			},
			type: kind,
			t: now - offset * 100
		}) as unknown as UndoEntry;

	it('renders per-entry summary and depth trailer', () => {
		const stack = { undo: [mkEntry('structural', 0), mkEntry('input-batch', 1)], redo: [] };
		const out = dumpUndoStack(stack, 10);
		expect(out).toContain('undo-depth=2 redo-depth=0');
		expect(out).toMatch(/\[0\] type=/);
	});
});

describe('dumpInlineTree', () => {
	it('renders inline tree for a prose block', () => {
		const doc = parse('**bold** text.\n');
		const para = doc.children[0];
		const range = getContentRange(para);
		const inline = parseInline(para.raw, range.start, range.end);
		const out = dumpInlineTree(inline);
		expect(out).toContain('strong');
		expect(out).toContain('text');
	});

	it('returns empty-string on undefined inline tree', () => {
		expect(dumpInlineTree(undefined)).toBe('');
	});
});

describe('dumpOperationsLog', () => {
	it('renders empty log as an explicit placeholder', () => {
		const log = createOperationsLog(10);
		expect(dumpOperationsLog(log, 5)).toBe('(no operations recorded)');
	});

	it('renders per-entry line with kind-specific fields', () => {
		const log = createOperationsLog(10);
		log.record({ op: 'split', path: [2, 0], detail: { at: 12 } });
		log.record({ op: 'paste', path: [1], detail: { strategy: 'inline', count: 1 } });
		const out = dumpOperationsLog(log, 10);
		expect(out).toContain('op=split path=[2,0] at=12');
		expect(out).toContain('op=paste path=[1] strategy=inline count=1');
	});

	it('limits output to the tail N entries', () => {
		const log = createOperationsLog(10);
		for (let i = 0; i < 5; i++) log.record({ op: 'split', path: [i], detail: { at: 0 } });
		const out = dumpOperationsLog(log, 2);
		const lines = out.split('\n').filter(Boolean);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('path=[3]');
		expect(lines[1]).toContain('path=[4]');
	});
});
