// @vitest-environment jsdom
//
// The clipboard skeleton's ORDER contract (docs/contributing/culture.md § the bug shape to
// fear). The four editable surfaces share createClipboardHandlers, which OWNS the arms that
// must stay in lockstep — the reading gate, the cross-block copy/cut write, the reveal fold,
// and the load-bearing scar: paste's preventDefault BEFORE any await. The per-surface tails
// (widget slice, rect payload, cell escaping) are exercised by the surface suites.
import { describe, it, expect } from 'vitest';
import {
	createClipboardHandlers,
	type ClipboardSurfaceDeps
} from '../../components/blocks/editable-surface';

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

/** A fully-instrumented dep set; each test overrides only the arms it exercises. A collapsed
 *  selection routes past writeCrossBlock{Copy,Cut}, so the intra-block tails run doc-free. */
function deps(log: string[], over: Partial<ClipboardSurfaceDeps> = {}): ClipboardSurfaceDeps {
	return {
		stickyColumn: { reset: () => log.push('reset') } as never,
		selection: { isCrossBlock: false, anchor: null, focus: null } as never,
		getDoc: () => null as never,
		crossBlock: {
			handlePaste: async () => {
				log.push('crossblock-paste');
				return false;
			},
			performCrossBlockDeleteFromEvent: async () => void log.push('cross-delete')
		} as never,
		isReadOnly: () => false,
		caret: { getEl: () => null, getCursorOffset: () => null, focus: () => {} },
		events: { on: () => () => {}, emit: () => {} },
		onPasteImage: undefined,
		cutTail: (e) => {
			log.push('cutTail');
			e.clipboardData?.setData('text/plain', 'CUT');
		},
		pasteTail: (_e, text) => void log.push(`pasteTail:${text}`),
		...over
	};
}

describe('clipboard skeleton — copy order', () => {
	it('non-reading, non-cross-block copy runs reset then the intra-block tail', () => {
		const log: string[] = [];
		const rec = recorder();
		const copyTail = (e: ClipboardEvent) => {
			e.preventDefault();
			log.push('copyTail');
		};
		createClipboardHandlers(deps(log, { copyTail })).onCopy(rec.e);
		expect(log).toEqual(['reset', 'copyTail']);
		expect(rec.prevented).toBe(true);
	});

	it('reading mode prevents and writes the visible selection, skipping every arm', () => {
		const log: string[] = [];
		const rec = recorder();
		let tailRan = false;
		createClipboardHandlers(
			deps(log, { isReadOnly: () => true, copyTail: () => void (tailRan = true) })
		).onCopy(rec.e);
		expect(log).toEqual(['reset']);
		expect(tailRan).toBe(false);
		expect(rec.prevented).toBe(true);
		expect(rec.written()).toBe(''); // jsdom's empty selection
	});

	it('a copy pre-hook that claims the event skips the cross-block write and the tail', () => {
		const log: string[] = [];
		const rec = recorder();
		let tailRan = false;
		createClipboardHandlers(
			deps(log, {
				copyPreHook: (e) => {
					e.preventDefault();
					log.push('copyPreHook');
					return true;
				},
				copyTail: () => void (tailRan = true)
			})
		).onCopy(rec.e);
		expect(log).toEqual(['reset', 'copyPreHook']);
		expect(tailRan).toBe(false);
	});
});

describe('clipboard skeleton — cut order', () => {
	it('folds the reveal before writing, prevents up front', async () => {
		const log: string[] = [];
		const rec = recorder();
		await createClipboardHandlers(
			deps(log, {
				foldReveal: () => {
					log.push('fold');
					return { caret: 3, settled: Promise.resolve() };
				}
			})
		).onCut(rec.e);
		expect(log).toEqual(['reset', 'fold', 'cutTail']);
		expect(rec.prevented).toBe(true);
	});

	it('reading mode degrades cut to copy — no fold, no cut tail, no cross-block delete', async () => {
		const log: string[] = [];
		const rec = recorder();
		let folded = false;
		let cutRan = false;
		await createClipboardHandlers(
			deps(log, {
				isReadOnly: () => true,
				foldReveal: () => {
					folded = true;
					return { caret: 1, settled: Promise.resolve() };
				},
				cutTail: () => void (cutRan = true)
			})
		).onCut(rec.e);
		expect(folded).toBe(false);
		expect(cutRan).toBe(false);
		expect(log).toEqual(['reset', 'reset']); // outer cut + inner copy
		expect(rec.prevented).toBe(true);
	});

	it('a cut pre-hook that claims the event skips the intra-block tail', async () => {
		const log: string[] = [];
		const rec = recorder();
		let cutRan = false;
		await createClipboardHandlers(
			deps(log, {
				cutPreHook: async () => {
					log.push('cutPreHook');
					return true;
				},
				cutTail: () => void (cutRan = true)
			})
		).onCut(rec.e);
		expect(log).toEqual(['reset', 'cutPreHook']);
		expect(cutRan).toBe(false);
	});
});

describe('clipboard skeleton — paste order', () => {
	it('prevents default synchronously, before the first await', () => {
		const log: string[] = [];
		const rec = recorder('X');
		// A deferred handlePaste that never resolves during this synchronous check:
		// if preventDefault sat behind the cross-block await, it would not have fired.
		const d = createClipboardHandlers(
			deps(log, { crossBlock: { handlePaste: () => new Promise<boolean>(() => {}) } as never })
		).onPaste(rec.e);
		void d;
		expect(rec.prevented).toBe(true);
	});

	it('runs fold, then cross-block, then reset, then the tail', async () => {
		const log: string[] = [];
		const rec = recorder('HELLO');
		await createClipboardHandlers(
			deps(log, {
				foldReveal: () => {
					log.push('fold');
					return { caret: 2, settled: Promise.resolve() };
				}
			})
		).onPaste(rec.e);
		expect(log).toEqual(['fold', 'crossblock-paste', 'reset', 'pasteTail:HELLO']);
	});

	it('reading mode prevents and stays inert — no cross-block, no tail', async () => {
		const log: string[] = [];
		const rec = recorder('X');
		let tailRan = false;
		await createClipboardHandlers(
			deps(log, { isReadOnly: () => true, pasteTail: () => void (tailRan = true) })
		).onPaste(rec.e);
		expect(log).toEqual([]);
		expect(tailRan).toBe(false);
		expect(rec.prevented).toBe(true);
	});

	it('an empty clipboard normalizes to nothing and never reaches the tail', async () => {
		const log: string[] = [];
		const rec = recorder(''); // nothing on the clipboard
		let tailRan = false;
		await createClipboardHandlers(deps(log, { pasteTail: () => void (tailRan = true) })).onPaste(
			rec.e
		);
		expect(log).toEqual(['crossblock-paste', 'reset']);
		expect(tailRan).toBe(false);
	});
});
