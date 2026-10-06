// @vitest-environment jsdom
// The step order `createClipboardHandlers` keeps for the four editable blocks: the reading
// check, each `ClipboardArm` in order, a cut's payload before the hide, and `preventDefault` on a paste
// before any await. Per-block parts (widget slice, cell escaping) are covered by each block's suite.
import { describe, it, expect } from 'vitest';
import {
	createClipboardHandlers,
	type ClipboardSurfaceDeps
} from '../../components/blocks/editable-surface';
import type { ClipboardArm } from '../../components/blocks/clipboard-step';
import { holdInsertion } from '$lib/cursor/next-insertion';

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
		copy(e) {
			log.push(`${name}.copy`);
			if (!takes) return null;
			e.clipboardData?.setData('text/plain', name);
			return { held: name };
		},
		remove: (held) => void log.push(`${name}.remove:${held}`)
	};
}

/** Every dependency logs its call; each test overrides only what it exercises. A collapsed
 *  selection skips the cross-block copy and cut, so the in-block steps need no document. */
function deps(log: string[], over: Partial<ClipboardSurfaceDeps> = {}): ClipboardSurfaceDeps {
	return {
		caretMemory: { forget: () => log.push('forget') } as never,
		selection: { isCrossBlock: false, anchor: null, focus: null } as never,
		getDoc: () => null as never,
		crossBlock: {
			handlePaste: async () => {
				log.push('crossblock-paste');
				return false;
			},
			performCrossBlockCut: async () => void log.push('cross-delete')
		} as never,
		isReadOnly: () => false,
		caret: {
			getEl: () => null,
			getCursorOffset: () => null,
			focus: () => {},
			recordPreEditOffset: () => void log.push('record'),
			getPreEditOffset: () => 0,
			getSelection: () => null,
			holdInsertion: () => holdInsertion([], {}, null)
		},
		events: { on: () => () => {}, emit: () => {} },
		onPasteImage: undefined,
		rangeArm: arm(log, 'range'),
		pasteTail: (text) => void log.push(`pasteTail:${text}`),
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
		createClipboardHandlers(deps(log, { rangeArm: arm(log, 'range', false) })).onCopy(rec.e);
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
		expect(log).toEqual(['forget', 'record', 'range.copy', 'fold']);
		expect(rec.written()).toBe('range');
		await cut;
		expect(log).toEqual(['forget', 'record', 'range.copy', 'fold', 'range.remove:range']);
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
		await createClipboardHandlers(deps(log, { selectionArms: [arm(log, 'widget')] })).onCut(rec.e);
		expect(log).toEqual(['forget', 'record', 'widget.copy', 'widget.remove:widget']);
	});

	it('a cut no arm takes writes nothing and removes nothing', async () => {
		const log: string[] = [];
		const rec = recorder();
		await createClipboardHandlers(deps(log, { rangeArm: arm(log, 'range', false) })).onCut(rec.e);
		expect(log).toEqual(['forget', 'record', 'range.copy']);
		expect(rec.written()).toBeNull();
		expect(rec.prevented).toBe(true);
	});
});

describe('clipboard skeleton: paste order', () => {
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

	it('records undo’s caret, then runs fold, cross-block, reset and the tail', async () => {
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
		expect(log).toEqual(['record', 'fold', 'crossblock-paste', 'forget', 'pasteTail:HELLO']);
	});

	it('reading mode prevents and stays inert: no cross-block, no tail', async () => {
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
		expect(log).toEqual(['record', 'crossblock-paste', 'forget']);
		expect(tailRan).toBe(false);
	});
});

// `insertMarkdown` is a second way into a paste, so it must run the gesture's steps in the same
// order; its promise resolves after the block's own paste step.
describe('clipboard skeleton: programmatic insertMarkdown', () => {
	it('runs the same record → fold → cross-block → reset → tail order a paste does', async () => {
		const log: string[] = [];
		const handlers = createClipboardHandlers(
			deps(log, {
				foldReveal: () => {
					log.push('fold');
					return { caret: 2, settled: Promise.resolve() };
				}
			})
		);
		expect(await handlers.insertMarkdown('HELLO')).toBe(true);
		expect(log).toEqual(['record', 'fold', 'crossblock-paste', 'forget', 'pasteTail:HELLO']);
	});

	it('hands the cross-block dispatch the payload, so a range is replaced rather than re-read', async () => {
		const log: string[] = [];
		const seen: Array<string | undefined> = [];
		const handlers = createClipboardHandlers(
			deps(log, {
				crossBlock: {
					handlePaste: async (_e: ClipboardEvent | null, replacement?: string) => {
						seen.push(replacement);
						return true;
					}
				} as never
			})
		);
		expect(await handlers.insertMarkdown('PAYLOAD')).toBe(true);
		expect(seen).toEqual(['PAYLOAD']);
	});

	it('declines in reading mode without touching a branch', async () => {
		const log: string[] = [];
		let tailRan = false;
		const handlers = createClipboardHandlers(
			deps(log, { isReadOnly: () => true, pasteTail: () => void (tailRan = true) })
		);
		expect(await handlers.insertMarkdown('X')).toBe(false);
		expect(log).toEqual([]);
		expect(tailRan).toBe(false);
	});

	it('declines an empty payload', async () => {
		const log: string[] = [];
		const handlers = createClipboardHandlers(deps(log));
		expect(await handlers.insertMarkdown('')).toBe(false);
		expect(log).toEqual([]);
	});

	it('normalizes CRLF the way a pasted payload is normalized', async () => {
		const log: string[] = [];
		const handlers = createClipboardHandlers(deps(log));
		expect(await handlers.insertMarkdown('a\r\nb')).toBe(true);
		expect(log).toEqual(['record', 'crossblock-paste', 'forget', 'pasteTail:a\nb']);
	});
});
