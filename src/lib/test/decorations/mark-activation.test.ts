// @vitest-environment jsdom
// The activate command runs the `onActivate` of the mark covering the caret, picked by the rule
// the pointer follows, and `canRunCommand` answers false wherever it would run nothing.
import { describe, it, expect, vi } from 'vitest';
import { createMarkActivation, type MarkActivationDeps } from '#lib/decorations/mark-activation.js';
import type { IndexedDecoration } from '#lib/decorations/buckets.js';
import type { MarkDecoration } from '#lib/decorations/types.js';
import { canRunCommandById, runCommandById } from '#lib/schema/block-commands.js';
import { commandContext } from '../harness/command-context';

type Call = { cls: string; anchor: DOMRect };

function mark(index: number, start: number, end: number, calls: Call[]) {
	const dec: MarkDecoration = {
		type: 'mark',
		path: [0],
		start,
		end,
		class: `m${index}`,
		interactive: { onActivate: (d, ctx) => calls.push({ cls: d.class, anchor: ctx.anchor }) }
	};
	return { dec, index };
}

function activation(
	marks: IndexedDecoration<MarkDecoration>[],
	offset: number | null,
	over: Partial<MarkActivationDeps> = {}
) {
	return createMarkActivation({
		caret: () => (offset === null ? null : { path: [0], offset }),
		marksForPath: () => marks,
		paintedRects: (dec) => [
			new DOMRect(dec.start * 8, 0, 80, 20),
			new DOMRect(0, 26, dec.end * 8, 20)
		],
		caretRect: () => new DOMRect(16, 28, 1, 16),
		runMarkHandler: (_dec, call) => call(),
		...over
	});
}

describe('createMarkActivation', () => {
	it('runs the covering mark once, anchored on its rect on the caret line', () => {
		const calls: Call[] = [];
		const run = activation([mark(0, 2, 9, calls)], 5);
		expect(run.canActivate()).toBe(true);
		expect(run.activate()).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].anchor.top).toBe(26);
	});

	it('picks the innermost of overlapping marks, then the earlier entry', () => {
		const calls: Call[] = [];
		activation([mark(0, 0, 9, calls), mark(1, 3, 6, calls), mark(2, 3, 6, calls)], 4).activate();
		expect(calls.map((c) => c.cls)).toEqual(['m1']);
	});

	it('counts a caret at either edge as inside the mark', () => {
		const calls: Call[] = [];
		activation([mark(0, 2, 9, calls)], 2).activate();
		activation([mark(0, 2, 9, calls)], 9).activate();
		expect(calls).toHaveLength(2);
	});

	it('answers false with no covering mark, no handler, or no caret', () => {
		const calls: Call[] = [];
		const plain = { index: 1, dec: { ...mark(1, 0, 9, calls).dec, interactive: undefined } };
		for (const run of [
			activation([mark(0, 2, 4, calls)], 7),
			activation([plain], 3),
			activation([mark(0, 2, 4, calls)], null)
		]) {
			expect(run.canActivate()).toBe(false);
			expect(run.activate()).toBe(false);
		}
		expect(calls).toHaveLength(0);
	});

	it('hands the handler to the guarded runner, so a throw is reported, not raised', () => {
		const reported = vi.fn();
		const boom: MarkDecoration = {
			type: 'mark',
			path: [0],
			start: 0,
			end: 3,
			class: 'boom',
			interactive: {
				onActivate: () => {
					throw new Error('plugin onActivate blew up');
				}
			}
		};
		const run = activation([{ dec: boom, index: 0 }], 1, {
			runMarkHandler: (_dec, call) => {
				try {
					call();
				} catch (error) {
					reported(error);
				}
			}
		});
		expect(run.activate()).toBe(true);
		expect(reported).toHaveBeenCalledOnce();
	});
});

describe('decorations.activateAtCaret dispatch', () => {
	const ID = 'decorations.activateAtCaret';

	it('can run only where a mark covers the caret, and runs it', () => {
		const activate = vi.fn(() => true);
		const covered = commandContext({ markActivation: { canActivate: () => true, activate } });
		expect(canRunCommandById(ID, null, covered)).toBe(true);
		expect(runCommandById(ID, undefined, null, covered)).toBe(true);
		expect(activate).toHaveBeenCalledOnce();

		expect(canRunCommandById(ID, null, commandContext())).toBe(false);
		expect(runCommandById(ID, undefined, null, commandContext())).toBe(false);
	});

	it('is refused in reading mode', () => {
		const ctx = commandContext({
			getPresentationMode: () => 'reading',
			markActivation: { canActivate: () => true, activate: () => true }
		});
		expect(canRunCommandById(ID, null, ctx)).toBe(false);
	});
});
