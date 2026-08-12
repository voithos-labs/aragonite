// Driving one block component through a mounted Editor. A bare mount keeps the pre-commit
// node — commits copy-path-on-write and in production the parent BlockHost re-renders with
// the fresh one — so a second gesture runs against a detached tree. The Editor mount puts the
// real reactive document underneath and makes `getSource()` a byte-exact assertion surface.
// Blocks are addressed by doc-absolute path, the coordinate the CST uses.

import { mount, unmount, flushSync, tick } from 'svelte';
import Editor from '$lib/components/Editor.svelte';
import type { EditorInstance, EditorProps } from '$lib/editor-props';
import { ambientLengthOf } from '$lib/ambient/ambient-dom';
import { asRawOffset, toDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeFromOffsets } from '$lib/cursor/content-offsets';

/** BlockHost measures its own height and scrolls reveals into view; jsdom has neither. */
export function installLayoutStubs(): void {
	(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
	Element.prototype.scrollIntoView = () => {};
}

export interface MountedEditor {
	instance: EditorInstance;
	target: HTMLElement;
	/** The document's bytes as they stand now. */
	source(): string;
	/** Drain the scheduler until the commit and its afterTick have settled. */
	settle(): Promise<void>;
	destroy(): Promise<void>;
}

export function mountEditor(props: EditorProps): MountedEditor {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Editor, { target, props }) as EditorInstance;
	flushSync();
	return {
		instance,
		target,
		source: () => instance.getSource(),
		settle: async () => {
			for (let i = 0; i < 12; i++) await tick();
		},
		destroy: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

/** The BlockHost at `path`, addressed the way the CST addresses it. */
export function blockHostAt(mounted: MountedEditor, path: number[]): HTMLElement {
	const el = mounted.target.querySelector<HTMLElement>(
		`[data-block-path="${JSON.stringify(path)}"]`
	);
	if (!el) throw new Error(`no block mounted at path ${JSON.stringify(path)}`);
	return el;
}

/** The prose surface of the block at `path`. Matches any `contenteditable` value — reading
 *  mode renders the same surface with `contenteditable="false"`, and its gate is only
 *  testable by delivering the key to it. */
export function surfaceAt(mounted: MountedEditor, path: number[]): HTMLElement {
	const host = blockHostAt(mounted, path);
	const el = host.querySelector<HTMLElement>('[contenteditable]');
	if (!el) throw new Error(`block at ${JSON.stringify(path)} has no prose surface`);
	return el;
}

/** Put a real caret at `rawOffset` in `el`. The DOM carries any ambient marker in front of
 *  raw offsets, so the translation goes through the shared coordinate helpers. */
export function placeCaret(el: HTMLElement, rawOffset: number): void {
	el.focus();
	const dom = toDomTextOffset(asRawOffset(rawOffset), ambientLengthOf(el));
	const range = createRangeFromOffsets(el, dom, dom);
	if (!range) throw new Error(`offset ${rawOffset} is out of range for this block`);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** Select `[start, end)` of `el` as a native range, the way a drag inside one block leaves it. */
export function selectRange(el: HTMLElement, start: number, end: number): void {
	el.focus();
	const ambient = ambientLengthOf(el);
	const range = createRangeFromOffsets(
		el,
		toDomTextOffset(asRawOffset(start), ambient),
		toDomTextOffset(asRawOffset(end), ambient)
	);
	if (!range) throw new Error(`range ${start}..${end} is out of range for this block`);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** Place the caret and dispatch a keydown from the block at `path`. The returned event's
 *  `defaultPrevented` is only meaningful once this has settled — the leaf prevents async. */
export async function pressKeyAt(
	mounted: MountedEditor,
	path: number[],
	rawOffset: number,
	init: KeyboardEventInit
): Promise<KeyboardEvent> {
	const el = surfaceAt(mounted, path);
	placeCaret(el, rawOffset);
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(event);
	await mounted.settle();
	return event;
}
