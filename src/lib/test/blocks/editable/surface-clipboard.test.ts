// @vitest-environment jsdom
// The editable surface's clipboard handlers: the order of a copy's and a cut's steps, and what
// the block answers a paste with.
import { describe, it, expect } from 'vitest';
import {
	createClipboardHandlers,
	type ClipboardSurfaceDeps
} from '../../../components/blocks/editable/surface-clipboard';
import { type ClipboardArm } from '../../../components/blocks/editable/clipboard-step';
import { createInsertionRecords } from '#lib/caret/next-insertion.js';

describe('step order', () => {
	// The order of steps `createClipboardHandlers` runs: reading check, each arm, a cut's payload
	// before the hide; a paste's reads before its source hides.

	interface Recorder {
		log: string[];
		prevented: boolean;
		written: () => string | null;
		e: ClipboardEvent;
	}

	function recorder(pasteText = ''): Recorder {
		const store = new Map<string, string>();
		if (pasteText) store.set('text/plain', pasteText);
		const rec: Recorder = {
			log: [],
			prevented: false,
			written: () => store.get('text/plain') ?? null,
			e: {
				preventDefault() {
					rec.prevented = true;
				},
				clipboardData: {
					setData: (t: string, v: string) => void store.set(t, v),
					getData: (t: string) => store.get(t) ?? ''
				}
			} as unknown as ClipboardEvent
		};
		return rec;
	}

	/** A `ClipboardArm` that logs its copy and removal; `takes: false` stands in for another kind. */
	function arm(log: string[], name: string, takes = true): ClipboardArm<string> {
		return {
			copy() {
				log.push(`${name}.copy`);
				return takes ? { write: { text: name }, held: name } : null;
			},
			remove: (held) => void log.push(`${name}.remove:${held}`)
		};
	}

	/** The block's own range, copied as `range`; `takes: false` copies nothing there. */
	function blockRange(
		log: string[],
		takes = true
	): Pick<ClipboardSurfaceDeps, 'copyRange' | 'removeRange'> {
		return {
			copyRange: () => {
				log.push('range.copy');
				return takes ? { text: 'range' } : null;
			},
			removeRange: (held) => void log.push(`range.remove:${held.start}-${held.end}`)
		};
	}

	/** Every dependency logs its call; each test overrides only what it exercises. A collapsed
	 *  selection skips the cross-block copy and cut, so the in-block steps need no document. */
	function deps(log: string[], over: Partial<ClipboardSurfaceDeps> = {}): ClipboardSurfaceDeps {
		return {
			caretMemory: { forget: () => log.push('forget') } as never,
			selection: { ownsRange: false, anchor: null, focus: null } as never,
			getDoc: () => null as never,
			crossBlock: {
				performCrossBlockCut: async () => void log.push('cross-delete')
			} as never,
			isReadOnly: () => false,
			caret: {
				recordPreEditOffset: () => void log.push('record'),
				getPreEditOffset: () => 3,
				getSelection: () => ({ start: 0, end: 5 }),
				holdInsertion: () => createInsertionRecords([]).hold({}, null)
			},
			endTypingBurst: () => void log.push('end-burst'),
			...blockRange(log),
			pasteRange: (selection) => (log.push('pasteRange'), selection),
			...over
		};
	}

	describe('clipboard skeleton: copy order', () => {
		it('resets, prevents, then writes the range arm’s payload', () => {
			const log: string[] = [];
			const rec = recorder();
			createClipboardHandlers(deps(log)).onCopy(rec.e);
			expect(log).toEqual(['forget', 'range.copy']);
			expect(rec.prevented).toBe(true);
			expect(rec.written()).toBe('range');
		});

		it('reading mode prevents and writes the visible selection, skipping every arm', () => {
			const log: string[] = [];
			const rec = recorder();
			createClipboardHandlers(deps(log, { isReadOnly: () => true })).onCopy(rec.e);
			expect(log).toEqual(['forget']);
			expect(rec.prevented).toBe(true);
			expect(rec.written()).toBe(''); // jsdom's empty selection
		});

		it('a selection arm that takes the copy skips the range arm', () => {
			const log: string[] = [];
			const rec = recorder();
			createClipboardHandlers(deps(log, { selectionArms: [arm(log, 'widget')] })).onCopy(rec.e);
			expect(log).toEqual(['forget', 'widget.copy']);
			expect(rec.written()).toBe('widget');
		});

		it('a copy no arm takes writes the visible selection', () => {
			const log: string[] = [];
			const rec = recorder();
			createClipboardHandlers(deps(log, blockRange(log, false))).onCopy(rec.e);
			expect(log).toEqual(['forget', 'range.copy']);
			expect(rec.written()).toBe('');
		});
	});

	describe('clipboard skeleton: cut order', () => {
		it('records undo’s caret and writes the payload before the hide, then removes', async () => {
			const log: string[] = [];
			const rec = recorder();
			const cut = createClipboardHandlers(
				deps(log, {
					foldReveal: () => {
						log.push('fold');
						return { caret: 3, settled: Promise.resolve() };
					}
				})
			).onCut(rec.e);
			// What a scripted cut can read: everything the dispatch ran before its first await.
			expect(log).toEqual(['forget', 'record', 'end-burst', 'range.copy', 'fold']);
			expect(rec.written()).toBe('range');
			await cut;
			expect(log).toEqual([
				'forget',
				'record',
				'end-burst',
				'range.copy',
				'fold',
				'range.remove:0-5',
				'end-burst'
			]);
			expect(rec.prevented).toBe(true);
		});

		it('reading mode degrades cut to copy: no record, no hide, no removal', async () => {
			const log: string[] = [];
			const rec = recorder();
			let folded = false;
			await createClipboardHandlers(
				deps(log, {
					isReadOnly: () => true,
					foldReveal: () => {
						folded = true;
						return { caret: 1, settled: Promise.resolve() };
					}
				})
			).onCut(rec.e);
			expect(folded).toBe(false);
			expect(log).toEqual(['forget']);
			expect(rec.prevented).toBe(true);
		});

		it('a selection arm that takes the cut removes its own selection, not the range', async () => {
			const log: string[] = [];
			const rec = recorder();
			await createClipboardHandlers(deps(log, { selectionArms: [arm(log, 'widget')] })).onCut(
				rec.e
			);
			expect(log).toEqual([
				'forget',
				'record',
				'end-burst',
				'widget.copy',
				'widget.remove:widget',
				'end-burst'
			]);
		});

		it('a cut no arm takes writes nothing and removes nothing', async () => {
			const log: string[] = [];
			const rec = recorder();
			await createClipboardHandlers(deps(log, blockRange(log, false))).onCut(rec.e);
			expect(log).toEqual(['forget', 'record', 'end-burst', 'range.copy', 'end-burst']);
			expect(rec.written()).toBeNull();
			expect(rec.prevented).toBe(true);
		});
	});

	// Miss-analysis: the paste's order was pinned through the block's own paste handler, which
	// read the clipboard and wrote the document; the answer a block gives the editor had no test.
	describe('what the block answers a paste with', () => {
		it('reads undo’s caret, the selection and the held records before the source hides', () => {
			const log: string[] = [];
			const settled = Promise.resolve();
			const caret = deps(log).caret;
			const answer = createClipboardHandlers(
				deps(log, {
					foldReveal: () => (log.push('fold'), { caret: 0, settled }),
					caret: {
						...caret,
						getSelection: () => (log.push('selection'), caret.getSelection()),
						holdInsertion: () => (log.push('hold'), caret.holdInsertion())
					}
				})
			).preparePaste();
			expect(log).toEqual(['record', 'selection', 'hold', 'fold', 'pasteRange', 'forget']);
			expect(answer).toMatchObject({ start: 0, end: 5, caretBefore: 3, settled });
		});

		it('names undo’s caret and the wait the block gives over the surface’s own', () => {
			const waits = Promise.resolve();
			const answer = createClipboardHandlers(
				deps([], { pasteRange: () => ({ start: 2, end: 4, caretBefore: 9, settled: waits }) })
			).preparePaste();
			expect(answer).toMatchObject({ start: 2, end: 4, caretBefore: 9, settled: waits });
		});

		it('lets the held records go where the block refuses the paste', () => {
			const finished: boolean[] = [];
			const held = {
				...createInsertionRecords([]).hold({}, null),
				finish: (changed: boolean) => void finished.push(changed)
			};
			const answer = createClipboardHandlers(
				deps([], {
					caret: { ...deps([]).caret, holdInsertion: () => held },
					pasteRange: () => null
				})
			).preparePaste();
			expect(answer).toBeNull();
			expect(finished).toEqual([false]);
		});
	});
});
