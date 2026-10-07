// @vitest-environment jsdom
// The editable surface's clipboard handlers: step order, then the image-paste branch.
import { describe, it, expect } from 'vitest';
import {
	createClipboardHandlers,
	type ClipboardSurfaceDeps
} from '../../components/blocks/editable-surface';
import { type ClipboardArm } from '../../components/blocks/clipboard-step';
import { createInsertionRecords } from '$lib/cursor/next-insertion';
import { type PastedImage } from '../../editor-keys';

describe('step order', () => {
	// The order of steps `createClipboardHandlers` runs: reading check, each arm, a cut's payload before the hide, paste's `preventDefault` before any await.

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
				holdInsertion: () => createInsertionRecords([]).hold({}, null)
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
			await createClipboardHandlers(deps(log, { selectionArms: [arm(log, 'widget')] })).onCut(
				rec.e
			);
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
});

describe('image paste', () => {
	// Image paste reads the files inside the event, prevents before awaiting, and inserts at the caret the paste started from.

	const imageFile = (name: string, type = 'image/png'): File =>
		new File([new Uint8Array([137, 80, 78, 71])], name, { type });

	/** A paste event carrying `files`, plus the `text/plain` a real image paste often
	 *  ships alongside them: the fallback that must not run once the image branch takes over. */
	function pasteEvent(files: File[], text = '') {
		let prevented = false;
		const e = {
			preventDefault: () => void (prevented = true),
			clipboardData: {
				files,
				setData: () => {},
				getData: (type: string) => (type === 'text/plain' ? text : '')
			}
		} as unknown as ClipboardEvent;
		return { e, wasPrevented: () => prevented };
	}

	interface SurfaceState {
		caret: number | null;
		el: HTMLElement | null;
	}

	const liveSurface = (): SurfaceState => ({ caret: 5, el: document.createElement('div') });

	/** A cross-block route that takes the paste, recording the text it was offered. */
	const claimingCrossBlock = (log: string[]) =>
		({
			handlePaste: async (_e: ClipboardEvent, replacement?: string) => {
				log.push(`crossblock-claimed:${replacement ?? ''}`);
				return true;
			}
		}) as never;

	function harness(over: Partial<ClipboardSurfaceDeps> = {}, state = liveSurface()) {
		const log: string[] = [];
		const inserted: string[] = [];
		const targets: (number | null)[] = [];
		const seated: number[] = [];
		const errors: unknown[] = [];
		const deps: ClipboardSurfaceDeps = {
			caretMemory: { forget: () => {} } as never,
			selection: { isCrossBlock: false } as never,
			getDoc: () => null as never,
			crossBlock: {
				handlePaste: async (_e: ClipboardEvent, replacement?: string) => {
					log.push(`crossblock:${replacement ?? ''}`);
					return false;
				}
			} as never,
			isReadOnly: () => false,
			caret: {
				getEl: () => state.el,
				getCursorOffset: () => state.caret,
				focus: (offset: number) => void seated.push(offset),
				recordPreEditOffset: () => {},
				getPreEditOffset: () => 0,
				getSelection: () =>
					state.caret === null ? null : { start: state.caret, end: state.caret },
				holdInsertion: () => createInsertionRecords([]).hold({}, null)
			},
			events: {
				emit: (name: string, payload: unknown) => void (name === 'error' && errors.push(payload))
			} as never,
			onPasteImage: undefined,
			rangeArm: { copy: () => null, remove: () => {} },
			pasteTail: (text, target) => {
				inserted.push(text);
				targets.push(target.range?.start ?? null);
			},
			...over
		};
		return { deps, log, inserted, targets, seated, errors };
	}

	describe('image paste: the hook contract', () => {
		it('hands each image file to the hook in clipboard order, blob and metadata intact', async () => {
			const seen: PastedImage[] = [];
			const files = [imageFile('a.png'), imageFile('b.jpg', 'image/jpeg')];
			const h = harness({
				onPasteImage: async (image) => {
					seen.push(image);
					return null;
				}
			});
			await createClipboardHandlers(h.deps).onPaste(pasteEvent(files).e);
			expect(seen.map((i) => i.suggestedName)).toEqual(['a.png', 'b.jpg']);
			expect(seen.map((i) => i.mimeType)).toEqual(['image/png', 'image/jpeg']);
			expect(seen.map((i) => i.blob)).toEqual(files);
		});

		it('prevents the native paste before the hook resolves', () => {
			const h = harness({ onPasteImage: () => new Promise<string | null>(() => {}) });
			const ev = pasteEvent([imageFile('a.png')], 'FALLBACK');
			void createClipboardHandlers(h.deps).onPaste(ev.e);
			expect(ev.wasPrevented()).toBe(true);
			expect(h.inserted).toEqual([]);
		});

		it('consumes the paste: the cross-block route is offered the markdown, never the clipboard text', async () => {
			const h = harness({ onPasteImage: async () => '![[a.png]]' });
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')], 'FALLBACK').e);
			expect(h.log).toEqual(['crossblock:![[a.png]]']);
			expect(h.inserted).toEqual(['![[a.png]]']);
		});
	});

	describe('image paste, replacing a cross-block selection', () => {
		it('hands the markdown to the cross-block route and skips the surface tail', async () => {
			const log: string[] = [];
			const h = harness({
				crossBlock: claimingCrossBlock(log),
				onPasteImage: async () => '![[a.png]]'
			});
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			// The cross-block paste deletes the range and inserts by path, so the originating
			// block's own paste step and its caret stay out of it.
			expect(log).toEqual(['crossblock-claimed:![[a.png]]']);
			expect(h.inserted).toEqual([]);
			expect(h.seated).toEqual([]);
		});

		// The image branch reads the selection live, so a cross-block selection collapsed during the
		// upload leaves nothing to act on, and the paste falls back to the caret it captured.
		it('a selection collapsed before the import lands falls through to the caret', async () => {
			let stillCrossBlock = true;
			const h = harness({
				crossBlock: { handlePaste: async () => stillCrossBlock } as never,
				onPasteImage: async () => {
					stillCrossBlock = false;
					return '![[a.png]]';
				}
			});
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			expect(h.inserted).toEqual(['![[a.png]]']);
		});

		it('the hook decides first: a null result destroys nothing', async () => {
			const log: string[] = [];
			const h = harness({ crossBlock: claimingCrossBlock(log), onPasteImage: async () => null });
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			expect(log).toEqual([]);
			expect(h.inserted).toEqual([]);
		});
	});

	describe('image paste: where the markdown lands', () => {
		it('inserts at the caret held when the paste fired, not where it moved to', async () => {
			const state = liveSurface();
			state.caret = 7;
			const h = harness(
				{
					onPasteImage: async () => {
						state.caret = 99;
						return '![[a.png]]';
					}
				},
				state
			);
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			expect(h.seated).toEqual([7]);
			expect(h.inserted).toEqual(['![[a.png]]']);
		});

		it('leaves an untouched selection alone, so the surface tail replaces it', async () => {
			const h = harness({ onPasteImage: async () => '![[a.png]]' });
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			// Placing the caret again collapses the DOM range, and every block reads its
			// replaced span from that range, so a caret that never moved is left alone.
			expect(h.seated).toEqual([]);
			expect(h.inserted).toEqual(['![[a.png]]']);
		});

		it('two images land as one insertion, in clipboard order', async () => {
			const h = harness({ onPasteImage: async (image) => `![[${image.suggestedName}]]` });
			await createClipboardHandlers(h.deps).onPaste(
				pasteEvent([imageFile('a.png'), imageFile('b.png')]).e
			);
			expect(h.inserted).toEqual(['![[a.png]]![[b.png]]']);
		});

		it('a null result for one of two images lands only the other', async () => {
			const h = harness({
				onPasteImage: async (image) => (image.suggestedName === 'a.png' ? null : '![[b.png]]')
			});
			await createClipboardHandlers(h.deps).onPaste(
				pasteEvent([imageFile('a.png'), imageFile('b.png')]).e
			);
			expect(h.inserted).toEqual(['![[b.png]]']);
			expect(h.errors).toEqual([]);
		});

		// Hiding a shown source leaves the caret on the widget's element edge, where it reads as
		// null, so the caret read as the paste arrived anchors the insertion.
		it('after a reveal fold, the caret read before the hide anchors the insertion', async () => {
			const state: SurfaceState = { caret: 3, el: document.createElement('div') };
			const h = harness(
				{
					foldReveal: () => {
						state.caret = null;
						return { caret: 3, settled: Promise.resolve() };
					},
					onPasteImage: async () => '![[a.png]]'
				},
				state
			);
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			expect(h.seated).toEqual([3]);
			expect(h.targets).toEqual([3]);
		});

		it('declines and reports when the surface is gone before a slow hook resolves', async () => {
			const state = liveSurface();
			const h = harness(
				{
					onPasteImage: async () => {
						state.el = null;
						return '![[a.png]]';
					}
				},
				state
			);
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			expect(h.inserted).toEqual([]);
			expect(h.errors).toHaveLength(1);
		});
	});

	describe('image paste, declining and failing', () => {
		it('a null result inserts nothing and reports nothing', async () => {
			const h = harness({ onPasteImage: async () => null });
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')], 'FALLBACK').e);
			expect(h.inserted).toEqual([]);
			expect(h.errors).toEqual([]);
		});

		it('a rejected import reports as origin `clipboard` and its sibling still lands', async () => {
			const boom = new Error('asset import failed');
			const h = harness({
				onPasteImage: async (image) => {
					if (image.suggestedName === 'a.png') throw boom;
					return '![[b.png]]';
				}
			});
			await createClipboardHandlers(h.deps).onPaste(
				pasteEvent([imageFile('a.png'), imageFile('b.png')]).e
			);
			expect(h.errors).toEqual([{ origin: 'clipboard', error: boom }]);
			expect(h.inserted).toEqual(['![[b.png]]']);
		});

		it('reading mode never reaches the hook', async () => {
			let called = false;
			const h = harness({
				isReadOnly: () => true,
				onPasteImage: async () => {
					called = true;
					return '![[a.png]]';
				}
			});
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
			expect(called).toBe(false);
			expect(h.inserted).toEqual([]);
		});
	});

	describe('image paste: pastes the branch must not claim', () => {
		it('without the hook, an image-bearing paste takes the text/plain path', async () => {
			const h = harness();
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')], 'FALLBACK').e);
			expect(h.inserted).toEqual(['FALLBACK']);
		});

		it('a non-image file is not an image paste', async () => {
			const h = harness({ onPasteImage: async () => '![[wrong]]' });
			const attachment = new File(['notes'], 'notes.txt', { type: 'text/plain' });
			await createClipboardHandlers(h.deps).onPaste(pasteEvent([attachment], 'FALLBACK').e);
			expect(h.inserted).toEqual(['FALLBACK']);
		});
	});
});
