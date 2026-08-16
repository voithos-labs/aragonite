// @vitest-environment jsdom
//
// Miss-analysis: the fold's only guard was "did the text change", which reads the CST at FOLD
// time — so every case that drove a reveal drove it over a document that stood still, and the one
// question the guard exists to answer (is the block I measured still the block at this index?)
// was never asked. The two ways it moves are an undo and a host `source` swap; both destroy the
// component, so no in-repo unit or e2e case could have caught it while asserting only bytes.
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import Editor from '$lib/components/Editor.svelte';
import type { EditorInstance } from '$lib/editor-props';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { installLayoutStubs } from '../../blocks/editor-mount';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

const OPENED = '$$\nold\n$$\n';

let target: HTMLElement | null = null;
let instance: EditorInstance | null = null;

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
	installLayoutStubs();
});

afterEach(async () => {
	if (instance) await unmount(instance);
	target?.remove();
	instance = null;
	target = null;
	resetPluginPlatformForTests();
});

/** An editor whose `source` prop is live, so a case can swap the document under a live reveal
 *  the way a host does. */
function mountEditorWithLiveSource(initial: string) {
	const props = $state({ source: initial, plugins: [latexPlugin({ renderer: stubRenderer })] });
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(Editor, { target, props }) as EditorInstance;
	flushSync();
	return {
		props,
		settle: async () => {
			for (let i = 0; i < 12; i++) await tick();
		},
		sourceEl: () => target!.querySelector<HTMLElement>('.math-block-source')
	};
}

async function revealWithDraft(
	editor: ReturnType<typeof mountEditorWithLiveSource>,
	draft: string
) {
	const probe = instance as unknown as {
		__test: { getBlockComponent(path: number[]): { parkCaret?(o: number): void } | null };
	};
	probe.__test.getBlockComponent([0])!.parkCaret!(0);
	await editor.settle();
	const el = editor.sourceEl();
	expect(el, 'the reveal mounted no source element').not.toBeNull();
	el!.textContent = draft;
	return el!;
}

describe('a render-primary fold writes back only what its reveal measured', () => {
	// An undo or a `source` swap replaces the node at this index and the blur lands afterwards.
	// Rewriting the live node's bytes with no tick in between is that state exactly: the mirror
	// has not run, so the surface still holds the draft the user typed against the OLD document.
	it('declines the fold when the document at the index moved under the open reveal', async () => {
		const editor = mountEditorWithLiveSource(OPENED);
		const el = await revealWithDraft(editor, '$$\ndraft\n$$');

		const doc = (
			instance as unknown as { __test: { getDocument(): { children: { raw: string }[] } } }
		).__test.getDocument();
		doc.children[0].raw = '$$\nrestored\n$$\n';
		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();

		expect(instance!.getSource()).toBe('$$\nrestored\n$$\n');
	});

	it('still commits an edit made over the document the reveal opened on', async () => {
		const editor = mountEditorWithLiveSource(OPENED);
		const el = await revealWithDraft(editor, '$$\nnew\n$$');

		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();

		expect(instance!.getSource()).toBe('$$\nnew\n$$\n');
	});
});

// Miss-analysis: the leaf's chord dispatch was pinned only on the revealed half, and every case
// that pressed a chord pressed it there — so the folded view, which is where the block sits for
// most of its life, went its whole existence with no keydown door and no case to notice.
describe('a render-primary block answers chords in either half of the swap', () => {
	it('undoes a committed edit while the FOLDED view holds focus', async () => {
		const editor = mountEditorWithLiveSource(OPENED);
		const el = await revealWithDraft(editor, '$$\nnew\n$$');
		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();
		expect(instance!.getSource()).toBe('$$\nnew\n$$\n');

		const rendered = target!.querySelector<HTMLElement>('.math-block-render');
		expect(rendered, 'the block did not fold back to its rendered view').not.toBeNull();
		rendered!.focus();
		rendered!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
		);
		await editor.settle();

		expect(instance!.getSource()).toBe(OPENED);
	});
});
