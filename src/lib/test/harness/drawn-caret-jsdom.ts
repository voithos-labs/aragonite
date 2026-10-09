// The drawn caret's paint under jsdom, which has no layout and no pointer: a collapsed range gets a
// box from its offset, the page answers a fine pointer, and frame callbacks wait in a queue until
// a test runs them, so every paint a row counts is one it caused.

import type { MountedEditor } from './mount-editor.svelte';
import type { DrawnCaret } from '#lib/caret/drawn-caret.svelte.js';

/** The test handle a row reaches the drawn caret through. */
export interface DrawnCaretSeam {
	getDrawnCaret(): DrawnCaret;
}

const frames: FrameRequestCallback[] = [];

/** For `beforeAll`; returns the restore for `afterAll`. */
export function installDrawnCaretStubs(): () => void {
	const realRects = Range.prototype.getClientRects;
	const realFrame = window.requestAnimationFrame;
	const realCancel = window.cancelAnimationFrame;
	Range.prototype.getClientRects = function (this: Range) {
		if (!this.collapsed || !this.startContainer.isConnected) return [] as unknown as DOMRectList;
		return [new DOMRect(100 + this.startOffset * 8, 10, 0, 20)] as unknown as DOMRectList;
	};
	(window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
		matches: query === '(pointer: fine)',
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	});
	window.requestAnimationFrame = (run) => frames.push(run);
	window.cancelAnimationFrame = (id) => {
		if (id > 0 && id <= frames.length) frames[id - 1] = () => {};
	};
	return () => {
		Range.prototype.getClientRects = realRects;
		window.requestAnimationFrame = realFrame;
		window.cancelAnimationFrame = realCancel;
		delete (window as unknown as { matchMedia?: unknown }).matchMedia;
		frames.length = 0;
	};
}

/** Runs the frame callbacks queued so far, as the next frame would; returns how many ran. */
export function runCaretFrames(): number {
	const due = frames.splice(0);
	for (const run of due) run(0);
	return due.length;
}

/** The marks the bar's look shows, empty for the plain bar; null while it draws no text caret. */
export function caretMarks(editor: MountedEditor): string[] | null {
	const bar = editor.target.querySelector<HTMLElement>('.md-drawn-caret');
	if (!bar || bar.hidden || bar.getAttribute('data-caret-state') !== 'text') return null;
	return bar.getAttribute('data-caret-marks')?.split(' ').filter(Boolean) ?? [];
}

/** Paints the caret where it stands now and waits for the paint, as any repaint request would. */
export async function paintCaret(editor: MountedEditor<DrawnCaretSeam>): Promise<void> {
	editor.instance.__test.getDrawnCaret().request();
	await editor.settle();
}
