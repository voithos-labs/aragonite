// Driving the mounted Editor through the props a host writes. A whole-document swap and a
// presentation-mode flip are both prop writes whose consequences live inside the component,
// so the specs that ask about them mount the real thing. One editor at a time.

import { mount, unmount, flushSync, tick } from 'svelte';
import Editor from '$lib/components/Editor.svelte';
import type { EditorInstance, EditorProps } from '$lib/editor-props';

export interface PropDrivenEditor<TestSeam> {
	editor: EditorInstance & { __test: TestSeam };
	/** Reactive: write a prop here to drive the component the way a host does. */
	props: EditorProps;
	target: HTMLElement;
}

let live: { instance: EditorInstance; target: HTMLElement } | null = null;

export function mountEditorOverProps<TestSeam = unknown>(
	initial: EditorProps
): PropDrivenEditor<TestSeam> {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const props = $state({ ...initial });
	const instance = mount(Editor, { target, props }) as EditorInstance;
	flushSync();
	live = { instance, target };
	return { editor: instance as PropDrivenEditor<TestSeam>['editor'], props, target };
}

/** Teardown for `afterEach`; a second call no-ops, so a spec may also unmount mid-test. */
export function unmountEditorOverProps(): void {
	if (!live) return;
	const { instance, target } = live;
	live = null;
	void unmount(instance);
	target.remove();
}

/** Apply the prop write, then let the deferred runs it schedules land: a swap bumps a tick
 *  past its own reset, so no subscriber reads a half-applied tree. */
export async function settlePropWrite(): Promise<void> {
	flushSync();
	await tick();
	await tick();
}

/** Type into the first prose block the way an input event reaches the editor. */
export function typeInFirstBlock(target: HTMLElement, text: string): void {
	const el = target.querySelector<HTMLElement>('.text-editable-block');
	if (!el) throw new Error('no prose block is mounted');
	el.textContent = text;
	el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}
