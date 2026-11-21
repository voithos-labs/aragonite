// @vitest-environment jsdom
// The React and Vue wrappers' refs are the editor's handle. A document loaded through it stays
// across a render that passes the same value, reports no change, and gives way to the next
// changed value; a mode set through it stays until the `presentationMode` prop changes.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { act, createElement, createRef, type ForwardRefExoticComponent, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createApp, h, nextTick, reactive, shallowRef, type App } from 'vue';
import type { EditorHandle } from '#lib/index.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { Aragonite as VueAragonite, type AragoniteInstance } from '../../../../packages/vue/src';

// The React wrapper is TSX, which the root type check doesn't compile and Vitest does.
const REACT_WRAPPER = '../../../../packages/react/src/aragonite.tsx';
type ReactProps = Record<string, unknown> & { ref: Ref<EditorHandle> };
let ReactAragonite: ForwardRefExoticComponent<ReactProps>;

beforeAll(async () => {
	installLayoutStubs();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	({ Aragonite: ReactAragonite } = await import(/* @vite-ignore */ REACT_WRAPPER));
});

const teardown: (() => void)[] = [];
afterEach(async () => {
	for (const down of teardown.splice(0)) down();
	await settleEditor();
});

const FIRST = 'first\n';
const host = () => document.body.appendChild(document.createElement('div'));

describe('the React ref', () => {
	async function mounted() {
		const root: Root = createRoot(host());
		const ref = createRef<EditorHandle>();
		const changes: string[] = [];
		const render = async (props: Record<string, unknown>) => {
			await act(async () =>
				root.render(
					createElement(ReactAragonite, { ref, onChange: changes.push.bind(changes), ...props })
				)
			);
			flushSync();
		};
		teardown.push(() => act(() => root.unmount()));
		await render({ value: FIRST, presentationMode: 'source' });
		return { editor: () => ref.current!, render, changes };
	}

	it('loads a document that a controlled value replaces on its next change', async () => {
		const { editor, render, changes } = await mounted();
		editor().load('loaded\n');
		await render({ value: FIRST, presentationMode: 'source' });
		expect([editor().getSource(), changes]).toEqual(['loaded\n', []]);
		await render({ value: 'next\n', presentationMode: 'source' });
		expect([editor().getSource(), changes]).toEqual(['next\n', []]);
	});

	it('keeps a mode set through it until the prop changes', async () => {
		const { editor, render } = await mounted();
		editor().setMode('live');
		await render({ value: FIRST, presentationMode: 'source' });
		expect(editor().mode.name).toBe('live');
		await render({ value: FIRST, presentationMode: 'reading' });
		expect(editor().mode.name).toBe('reading');
	});
});

describe('the Vue ref', () => {
	async function mounted() {
		const props = reactive({ modelValue: FIRST, presentationMode: 'source' as const, round: 0 });
		const ref = shallowRef<AragoniteInstance | null>(null);
		const emitted: string[] = [];
		// `title` falls through to the root, so bumping `round` renders the wrapper again.
		const app: App = createApp({
			render: () =>
				h(VueAragonite, {
					ref,
					modelValue: props.modelValue,
					presentationMode: props.presentationMode,
					title: String(props.round),
					'onUpdate:modelValue': (value: string) => emitted.push(value)
				})
		});
		app.mount(host());
		teardown.push(() => app.unmount());
		const settle = async () => {
			await nextTick();
			flushSync();
		};
		await settle();
		return { editor: () => ref.value!.handle!, props, emitted, settle };
	}

	it('loads a document that a bound value replaces on its next change', async () => {
		const { editor, props, emitted, settle } = await mounted();
		editor().load('loaded\n');
		props.round++;
		await settle();
		expect([editor().getSource(), emitted]).toEqual(['loaded\n', []]);
		props.modelValue = 'next\n';
		await settle();
		expect([editor().getSource(), emitted]).toEqual(['next\n', []]);
	});

	it('keeps a mode set through it until the prop changes', async () => {
		const { editor, props, settle } = await mounted();
		editor().setMode('live');
		props.round++;
		await settle();
		expect(editor().mode.name).toBe('live');
		(props as { presentationMode: string }).presentationMode = 'reading';
		await settle();
		expect(editor().mode.name).toBe('reading');
	});
});
