// @vitest-environment jsdom
//
// A CRLF-authored fenced code block keeps its trailing `\r\n` across every keystroke-commit
// gesture: each strips the ending to edit the body, then reconstructs it via
// trailingLineEnding(node.raw) (G4.20). A bare `\n` literal downgrades the block to LF.
// Driven through the mounted component's real handlers — the commit closures live there,
// where the G4.20 source-scan lint cannot observe runtime output.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import { parse } from '$lib/core/parser';
import { vi } from 'vitest';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

function mountCode(source: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse(source);
	const blockEdit = makeStubBlockEdit();
	const instance = mount(CodeBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();
	const el = target.querySelector('.code-block') as HTMLElement;
	return { instance, el, blockEdit };
}

/** Collapse the DOM selection at the end of the block's display text. */
function selectEnd(el: HTMLElement): void {
	const range = document.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

let mounted: ReturnType<typeof mountCode>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('CodeBlock keystroke commit preserves the trailing line ending', () => {
	it('a typed edit on a CRLF block commits raw ending in `\\r\\n`', () => {
		mounted = mountCode('```\r\ncode\r\n```\r\n');
		const { el, blockEdit } = mounted;
		el.textContent = 'edited';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));

		expect(blockEdit.updateBlockContent).toHaveBeenCalledTimes(1);
		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.endsWith('\r\n')).toBe(true);
	});

	it('a typed edit on an LF block still commits raw ending in `\\n` (unchanged)', () => {
		mounted = mountCode('```\ncode\n```\n');
		const { el, blockEdit } = mounted;
		el.textContent = 'edited';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));

		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.endsWith('\r\n')).toBe(false);
		expect(newRaw.endsWith('\n')).toBe(true);
	});
});

describe('CodeBlock fence auto-close mints a CRLF paragraph below', () => {
	// Enter on an unclosed fence's trailing blank line mints the closer AND the paragraph below
	// in one replaceBlock; both are pure line ending, so both take the fence's (G4.20).
	it('the minted paragraph carries the fence’s line ending, not a literal LF', () => {
		mounted = mountCode('```js\r\ncode\r\n\r\n');
		const { instance, el } = mounted;
		el.focus();
		selectEnd(el);
		instance.runCommand('code.newline');

		const [, replacement] = vi.mocked(mounted.blockEdit.replaceBlock).mock.calls[0];
		expect(replacement[0].raw).toBe('```js\r\ncode\r\n```\r\n');
		expect(replacement[1].leadingTrivia).toBe('\r\n');
		expect(replacement[1].raw).toBe('\r\n');
	});
});

describe('CodeBlock code.newline commit preserves the trailing line ending', () => {
	// Driven via the exported runCommand, the dispatch entry the Enter keydown itself calls: a
	// raw keydown cannot reach it in an isolated mount (no block-command registry wired).
	it('a CST newline on a CRLF block commits raw ending in `\\r\\n`', () => {
		mounted = mountCode('```\r\ncode\r\n```\r\n');
		const { instance, el, blockEdit } = mounted;
		el.focus();
		instance.runCommand('code.newline');

		expect(blockEdit.updateBlockContent).toHaveBeenCalledTimes(1);
		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.endsWith('\r\n')).toBe(true);
	});

	// Reattaching the trailing ending was never the whole rule: the newline Enter splices INTO
	// the body, so a bare `\n` there leaves a lone LF inside a CRLF block.
	it('the spliced newline is CRLF too, not a bare LF in the body', () => {
		mounted = mountCode('```\r\ncode\r\n```\r\n');
		const { instance, el, blockEdit } = mounted;
		el.focus();
		instance.runCommand('code.newline');

		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.replace(/\r\n/g, '')).not.toContain('\n');
	});

	it('an LF block still splices a bare LF', () => {
		mounted = mountCode('```\ncode\n```\n');
		const { instance, el, blockEdit } = mounted;
		el.focus();
		instance.runCommand('code.newline');

		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw).not.toContain('\r');
	});
});
