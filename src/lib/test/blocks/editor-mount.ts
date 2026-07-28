// Driving one block component through a mounted Editor.
//
// A container block cannot be usefully mounted on its own: the commit primitives
// copy-path-on-write, so every commit REPLACES the container node, and in production
// it is the parent BlockHost that re-renders the component with the fresh node. A
// bare `mount(ListBlock, { props: { node } })` keeps the pre-commit node, and any
// second gesture then runs against a detached tree. Mounting the Editor puts the
// real reactive document underneath, so a multi-keystroke sequence behaves the way
// it does in the editor and `getSource()` is a byte-exact assertion surface.
//
// Blocks are addressed by their doc-absolute path, the same coordinate the CST uses,
// so a test names the block it means rather than counting DOM nodes.

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

/**
 * The prose surface of the block at `path`. Matches any `contenteditable` value:
 * reading mode renders the same surface with `contenteditable="false"`, and a
 * reading-mode gate is only testable by delivering the key to it.
 */
export function surfaceAt(mounted: MountedEditor, path: number[]): HTMLElement {
	const host = blockHostAt(mounted, path);
	const el = host.querySelector<HTMLElement>('[contenteditable]');
	if (!el) throw new Error(`block at ${JSON.stringify(path)} has no prose surface`);
	return el;
}

/**
 * Put a real caret at `rawOffset` in `el`. Raw offsets are the block's own byte
 * coordinates; the DOM carries any ambient marker in front of them, so the
 * translation goes through the shared coordinate helpers rather than being
 * recomputed here.
 */
export function placeCaret(el: HTMLElement, rawOffset: number): void {
	el.focus();
	const dom = toDomTextOffset(asRawOffset(rawOffset), ambientLengthOf(el));
	const range = createRangeFromOffsets(el, dom, dom);
	if (!range) throw new Error(`offset ${rawOffset} is out of range for this block`);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/**
 * Place the caret and dispatch a keydown from the block at `path`. Returns the event
 * so a caller can read `defaultPrevented` — the leaf's own handlers preventDefault
 * asynchronously, so that read is only meaningful after this has settled.
 */
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
