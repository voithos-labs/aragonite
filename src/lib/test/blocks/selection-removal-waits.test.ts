// @vitest-environment jsdom
// Enter over a selection runs its line break only once the selection's removal has landed, and
// not at all when the removal's bytes don't land.
// Miss-analysis: every Enter-over-selection test committed at once, so a block that answered its
// removal before the write settled ran the break early with every suite green.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Component } from 'svelte';
import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { mountBlock, type MountedBlock } from '$lib/test/harness/mount-block';
import { makeStubBlockEdit } from '$lib/test/harness/editor-actions';
import { settleEditor } from '$lib/test/harness/settle';

let mounted: MountedBlock<Record<string, unknown>>;

afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

const BLOCKS = [
	{ kind: 'a code block', component: CodeBlock, source: '```\nfoo bar\n```\n', at: 8 },
	{ kind: 'a paragraph', component: TextEditableBlock, source: 'foo bar\n', at: 4 }
] as const;

/** The block mounted over a stub list whose content writes settle only when the test says. */
function mountHeld(component: Component<any, any>, source: string) {
	const blockEdit = makeStubBlockEdit();
	let settle: (landed: boolean) => void = () => {};
	vi.mocked(blockEdit.updateBlockContent).mockImplementation((_index, _text, _mode, pre, saved) =>
		withStoredCaret(new Promise<boolean>((done) => (settle = done)), saved ?? pre)
	);
	mounted = mountBlock(component, { source, overrides: { blockEdit } });
	const calls = () =>
		Object.values(blockEdit)
			.filter((spy) => vi.isMockFunction(spy))
			.reduce((sum, spy) => sum + vi.mocked(spy).mock.calls.length, 0);
	return { calls, settle: (landed: boolean) => settle(landed) };
}

function pressEnterOver(start: number, end: number): void {
	const el = mounted.target.querySelector('[contenteditable="true"]') as HTMLElement;
	const range = createRangeAtDomTextOffsets(el, asDomTextOffset(start), asDomTextOffset(end));
	el.focus();
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range!);
	el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe.each(BLOCKS)('Enter over a selection in $kind', ({ component, source, at }) => {
	it('breaks the line only after the removal lands', async () => {
		const held = mountHeld(component, source);
		pressEnterOver(at, at + 3);
		await settleEditor();
		expect(held.calls()).toBe(1);

		held.settle(true);
		await settleEditor();
		expect(held.calls()).toBeGreaterThan(1);
	});

	it('breaks nothing when the removal lands no bytes', async () => {
		const held = mountHeld(component, source);
		pressEnterOver(at, at + 3);
		await settleEditor();

		held.settle(false);
		await settleEditor();
		expect(held.calls()).toBe(1);
	});
});
