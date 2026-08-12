// @vitest-environment jsdom
//
// The image-paste arm of the clipboard skeleton. `onPasteImage` is a host hook, so the arm's
// whole job is the ceremony around it: read the clipboard's files inside the synchronous event
// window, prevent before anything awaits, call the hook once per image in clipboard order, and
// insert at the caret the paste STARTED from — a hook that takes seconds to upload must not
// follow a caret the user moved meanwhile. Driven through createClipboardHandlers.
import { describe, it, expect } from 'vitest';
import {
	createClipboardHandlers,
	type ClipboardSurfaceDeps
} from '../../components/blocks/editable-surface';
import type { PastedImage } from '../../editor-keys';

const imageFile = (name: string, type = 'image/png'): File =>
	new File([new Uint8Array([137, 80, 78, 71])], name, { type });

/** A paste event carrying `files`, plus the `text/plain` a real image paste often
 *  ships alongside them — the fallback that must NOT run once the arm consumes. */
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

/** A cross-block route that claims the paste, recording the text it was offered. */
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
	const folds: (number | null)[] = [];
	const seated: number[] = [];
	const errors: unknown[] = [];
	const deps: ClipboardSurfaceDeps = {
		stickyColumn: { reset: () => {} } as never,
		edgeAffinity: {
			reset: () => {},
			get: () => null,
			note: () => {},
			noteTyping: () => {}
		} as never,
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
			focus: (offset: number) => void seated.push(offset)
		},
		events: {
			emit: (name: string, payload: unknown) => void (name === 'error' && errors.push(payload))
		} as never,
		onPasteImage: undefined,
		cutTail: () => {},
		pasteTail: (text, foldedCaret) => {
			inserted.push(text);
			folds.push(foldedCaret);
		},
		...over
	};
	return { deps, log, inserted, folds, seated, errors };
}

describe('image paste — the hook contract', () => {
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

describe('image paste — replacing a cross-block selection', () => {
	it('hands the markdown to the cross-block route and skips the surface tail', async () => {
		const log: string[] = [];
		const h = harness({
			crossBlock: claimingCrossBlock(log),
			onPasteImage: async () => '![[a.png]]'
		});
		await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
		// The route deletes the range and inserts by PATH, so the originating
		// surface's tail (and its caret) must stay out of it entirely.
		expect(log).toEqual(['crossblock-claimed:![[a.png]]']);
		expect(h.inserted).toEqual([]);
		expect(h.seated).toEqual([]);
	});

	// The branch reads the selection LIVE, so a cross-block selection collapsed while the host
	// uploaded leaves nothing to claim — the paste falls back to the anchor captured when it fired.
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

	it('the hook decides first — a null result destroys nothing', async () => {
		const log: string[] = [];
		const h = harness({ crossBlock: claimingCrossBlock(log), onPasteImage: async () => null });
		await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
		expect(log).toEqual([]);
		expect(h.inserted).toEqual([]);
	});
});

describe('image paste — where the markdown lands', () => {
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
		// Re-seating collapses the DOM range, and every surface tail derives its
		// replaced span from that range — so a caret that never moved is left alone.
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

	// The fold is the one path where the surface reads a null caret — it lands on the
	// widget's element-level edge — so the committed caret has to carry the anchor.
	it('after a reveal fold, the committed caret anchors the insertion', async () => {
		const state: SurfaceState = { caret: null, el: document.createElement('div') };
		const h = harness(
			{
				foldReveal: () => ({ caret: 3, settled: Promise.resolve() }),
				onPasteImage: async () => '![[a.png]]'
			},
			state
		);
		await createClipboardHandlers(h.deps).onPaste(pasteEvent([imageFile('a.png')]).e);
		expect(h.seated).toEqual([3]);
		expect(h.folds).toEqual([3]);
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

describe('image paste — declining and failing', () => {
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

describe('image paste — pastes the arm must not claim', () => {
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
