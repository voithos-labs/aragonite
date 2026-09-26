// The real Editor mounted over a source, the one editor mount every unit suite uses. A bare block
// mount keeps the node it was handed; under the Editor a commit re-renders with the replacement,
// `props` are reactive the way a host's are, and `source()` is a byte-exact read. Blocks are
// addressed by doc-absolute path, the coordinate the CST uses.

import { mount, unmount, flushSync } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import Editor from '$lib/components/Editor.svelte';
import type { EditorInstance, EditorProps } from '$lib/editor-props';
import { placeCaretAtRaw, selectRawRange } from '$lib/cursor/widget-offset';
import { settleEditor, pressKey } from '$lib/test/harness/settle';

/** Every mount suite runs the published helpers, so a plugin author's stub is checked here. */
export { installEditorDomStubsForTests as installLayoutStubs } from '$lib/testing';

export interface MountedEditor<Seam = unknown> {
	instance: EditorInstance & { __test: Seam };
	/** Reactive: write a prop here to drive the component the way a host does. */
	props: EditorProps;
	target: HTMLElement;
	/** The document's bytes as they stand now. */
	source(): string;
	settle(): Promise<void>;
	/** A second call does nothing, so a test may unmount mid-case and still tear down after. */
	destroy(): Promise<void>;
}

const live = new Set<MountedEditor<unknown>>();

export function mountEditor<Seam = unknown>(initial: EditorProps): MountedEditor<Seam> {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const props = hostProps(initial);
	const instance = mount(Editor, { target, props }) as MountedEditor<Seam>['instance'];
	flushSync();
	const mounted: MountedEditor<Seam> = {
		instance,
		props,
		target,
		source: () => instance.getSource(),
		settle: settleEditor,
		destroy: async () => {
			if (!live.delete(mounted)) return;
			await unmount(instance);
			target.remove();
		}
	};
	live.add(mounted);
	return mounted;
}

/** Props a test writes the way a host does: each key is reactive, and a value is stored as given,
 *  not wrapped in a deep proxy, so a plugin definition keeps its identity across editors. */
function hostProps(initial: EditorProps): EditorProps {
	const values = new SvelteMap<PropertyKey, unknown>(Object.entries(initial));
	return new Proxy({} as EditorProps, {
		get: (_, key) => values.get(key),
		set: (_, key, value) => {
			values.set(key, value);
			return true;
		},
		has: (_, key) => values.has(key),
		ownKeys: () =>
			[...values.keys()].filter((key) => typeof key !== 'number') as (string | symbol)[],
		getOwnPropertyDescriptor: (_, key) =>
			values.has(key)
				? { value: values.get(key), writable: true, enumerable: true, configurable: true }
				: undefined
	});
}

/** Teardown for `afterEach`: every editor still mounted. */
export async function destroyMountedEditors(): Promise<void> {
	for (const mounted of [...live]) await mounted.destroy();
}

/** Type into the first prose block the way an input event reaches the editor. */
export function typeInFirstBlock(target: HTMLElement, text: string): void {
	const el = target.querySelector<HTMLElement>('.text-editable-block');
	if (!el) throw new Error('no prose block is mounted');
	el.textContent = text;
	el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/** The BlockHost at `path`, addressed the way the CST addresses it. */
export function blockHostAt(mounted: MountedEditor, path: number[]): HTMLElement {
	const el = mounted.target.querySelector<HTMLElement>(
		`[data-block-path="${JSON.stringify(path)}"]`
	);
	if (!el) throw new Error(`no block mounted at path ${JSON.stringify(path)}`);
	return el;
}

/** The editable element of the block at `path`. Matches any `contenteditable` value, since
 *  mode renders the same surface with `contenteditable="false"`, and its gate is only
 *  testable by delivering the key to it. */
export function surfaceAt(mounted: MountedEditor, path: number[]): HTMLElement {
	const host = blockHostAt(mounted, path);
	const el = host.querySelector<HTMLElement>('[contenteditable]');
	if (!el) throw new Error(`block at ${JSON.stringify(path)} has no prose surface`);
	return el;
}

/** Put a real caret at `rawOffset` in `el`, through the editor's own caret writer. */
export function placeCaret(el: HTMLElement, rawOffset: number): void {
	el.focus();
	if (!placeCaretAtRaw(el, rawOffset, { clamp: 'exact' })) {
		throw new Error(`offset ${rawOffset} is out of range for this block`);
	}
}

/** Select `[start, end)` of `el` as a native range, the way a drag inside one block leaves it. */
export function selectRange(el: HTMLElement, start: number, end: number): void {
	el.focus();
	if (!selectRawRange(el, start, end)) {
		throw new Error(`range ${start}..${end} is out of range for this block`);
	}
}

/** Place the caret and dispatch a keydown from the block at `path`. The returned event's
 *  `defaultPrevented` only means anything once this has settled, since the leaf is async. */
export async function pressKeyAt(
	mounted: MountedEditor,
	path: number[],
	rawOffset: number,
	init: KeyboardEventInit
): Promise<KeyboardEvent> {
	const el = surfaceAt(mounted, path);
	placeCaret(el, rawOffset);
	return pressKey(el, init);
}
