// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEditorRootClipboard } from '$lib/components/editor-root-clipboard';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { registerEditor, __resetActiveEditorForTests } from '$lib/active-editor';
import { parse } from '$lib/core/parser';
import { createEditorEvents, type EditorError } from '$lib/editor-events';
import type { PasteImageHook } from '$lib/editor-keys';
import type { CrossBlockHandlers } from '$lib/selection/cross-block/dispatch';

// The escape this seam exists for: Chromium retargets the clipboard event to
// <body> when the cross-block park found no caret at the focus endpoint. The
// tests drive that retarget directly — target, not activeElement, is what the
// gate can see (a block still held focus in every real reproduction).

interface HarnessOptions {
	onPasteImage?: PasteImageHook;
	/** What the cross-block seam answers — false stands in for a selection that
	 *  collapsed while a host import was in flight. */
	crossBlockClaims?: boolean;
}

function harness(options: HarnessOptions = {}) {
	const root = document.createElement('div');
	root.tabIndex = -1;
	document.body.append(root);
	registerEditor(root);

	const selection = createSelectionState();
	const doc = parse('hello\n\nworld\n');
	const pasted: (string | undefined)[] = [];
	const deleted = vi.fn(async () => {});
	const crossBlock = {
		handlePaste: async (_e: ClipboardEvent, replacement?: string) => {
			pasted.push(replacement);
			return options.crossBlockClaims ?? true;
		},
		performCrossBlockDeleteFromEvent: deleted
	} as unknown as CrossBlockHandlers;

	const events = createEditorEvents();
	const errors: EditorError[] = [];
	events.on('error', (e) => errors.push(e));

	const clipboard = createEditorRootClipboard({
		selection,
		getDoc: () => doc,
		crossBlock,
		onPasteImage: options.onPasteImage,
		events
	});

	function fire(
		type: 'copy' | 'cut' | 'paste',
		target: EventTarget | null,
		{ prevented = false, files = [] as File[] } = {}
	): { written: Map<string, string>; preventCount: number } {
		const written = new Map<string, string>();
		let preventCount = prevented ? 1 : 0;
		const event = {
			target,
			get defaultPrevented() {
				return preventCount > 0;
			},
			preventDefault: () => {
				preventCount++;
			},
			clipboardData: {
				files,
				setData: (t: string, v: string) => written.set(t, v),
				getData: () => ''
			}
		} as unknown as ClipboardEvent;
		if (type === 'copy') clipboard.handleCopy(event, root);
		if (type === 'cut') clipboard.handleCut(event, root);
		if (type === 'paste') clipboard.handlePaste(event, root);
		return { written, preventCount };
	}

	return { root, selection, clipboard, fire, pasted, deleted, errors };
}

const pngFile = () => new File([new Uint8Array([137, 80])], 'shot.png', { type: 'image/png' });

describe('editor-root clipboard routing', () => {
	beforeEach(() => {
		__resetActiveEditorForTests();
		document.body.replaceChildren();
	});

	it('writes the cross-block text for a copy that landed on the body', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('copy', document.body).written.get('text/plain')).toContain('hello');
	});

	it('writes for a copy that landed on the root itself', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('copy', h.root).written.get('text/plain')).toContain('hello');
	});

	it('declines when a block surface already claimed the event', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('copy', document.body, { prevented: true }).written.size).toBe(0);
	});

	it('declines a target inside the editor that is not the root', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });
		// The search bar's input and a host header field both live here and own
		// their own clipboard; claiming "anywhere inside the root" would eat them.
		const input = document.createElement('input');
		h.root.append(input);

		expect(h.fire('copy', input).written.size).toBe(0);
	});

	it('declines when the selection is not cross-block', () => {
		const h = harness();

		expect(h.fire('copy', document.body).written.size).toBe(0);
	});

	it('declines the body arm when a second editor holds the claim', () => {
		const h = harness();
		const other = document.createElement('div');
		document.body.append(other);
		registerEditor(other);
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		// Two mounted editors and no live focus claim: neither may guess.
		expect(h.fire('copy', document.body).written.size).toBe(0);
	});

	it('cut writes the text and runs the range delete', async () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('cut', document.body).written.get('text/plain')).toContain('hello');
		await vi.waitFor(() => expect(h.deleted).toHaveBeenCalledOnce());
	});

	it('paste routes to the cross-block handler', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		h.fire('paste', document.body);
		expect(h.pasted).toEqual([undefined]);
	});

	// The gap the fallback did not close: a block surface offers the host hook its
	// files first, and this seam went straight to the cross-block arm — where a
	// pure-image paste carries no text/plain and was discarded.
	describe('image-bearing paste', () => {
		it('offers the files to the host hook before the cross-block arm', async () => {
			const imported: string[] = [];
			const h = harness({
				onPasteImage: async (image) => {
					imported.push(image.suggestedName ?? '');
					return '![[shot.png]]';
				}
			});
			h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

			const { preventCount } = h.fire('paste', document.body, { files: [pngFile()] });

			// Prevented BEFORE the hook is awaited, or the browser's own paste fires
			// during the import and injects DOM the CST never sees.
			expect(preventCount).toBe(1);
			await vi.waitFor(() => expect(h.pasted).toEqual(['![[shot.png]]']));
			expect(imported).toEqual(['shot.png']);
		});

		it('reports the decline when nothing claims the imported markdown', async () => {
			// `claims` required a cross-block selection, but the hook is awaited — a
			// selection collapsed meanwhile leaves the root with no landing at all.
			const h = harness({
				onPasteImage: async () => '![[shot.png]]',
				crossBlockClaims: false
			});
			h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

			h.fire('paste', document.body, { files: [pngFile()] });

			await vi.waitFor(() => expect(h.errors.map((e) => e.origin)).toEqual(['clipboard']));
			// Captured synchronously with the event. Reading it at the decline instead
			// would report nothing every time: the only way to REACH the decline is a
			// selection that collapsed, and a collapsed selection has no start.
			expect(h.errors[0].context?.path).toEqual([0]);
		});

		it('leaves an image paste on the text route when no hook is installed', async () => {
			const h = harness();
			h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

			h.fire('paste', document.body, { files: [pngFile()] });

			await vi.waitFor(() => expect(h.pasted).toEqual([undefined]));
			expect(h.errors).toEqual([]);
		});
	});
});
