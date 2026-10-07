// @vitest-environment jsdom
// The fence rule on the code block's own commit path: both commit paths, a keystroke and an IME
// composition end, hand the write what the browser left as typed bytes, and the write's fence
// rule reconciles them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { placeCaretAtRaw } from '#lib/cursor/widget-offset.js';
import { parse } from '#lib/core/parser.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { mountCode, type MountedCode } from './mount-code';

const SOURCE = '```js\nconst x = 1\n```\n';

let mounted: MountedCode;

/** What the browser leaves behind after its own edit: new text, with the caret in it. */
function nativeEdit(display: string, caret: number): void {
	mounted.el.textContent = display;
	mounted.el.focus();
	placeCaretAtRaw(mounted.el, caret, { clamp: 'exact' });
}

/** The bytes the write stores for the one commit the block made. */
function committed(): string {
	const calls = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
	expect(calls.length).toBe(1);
	const [index, text, mode] = calls[0];
	expect(mode).toBe('authored');
	const target = { children: parse(SOURCE).children, owner: undefined, lineEnding: '\n' as const };
	return trimTrailingLineEnding(legalizeWrite(target, index, text, mode).text);
}

beforeEach(() => {
	mounted = mountCode(SOURCE);
});
afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('CodeBlock: the write path on commit', () => {
	// Parser-verified: the typed run closes the block early and the tail becomes a
	// fence that swallows every following block.
	it('grows both fence runs when typing lands a closer on a body line', () => {
		nativeEdit('```js\n```\nconst x = 1\n```', 9);
		mounted.el.dispatchEvent(new Event('input', { bubbles: true }));

		expect(committed()).toBe('````js\n```\nconst x = 1\n````');
	});

	it('drops a backtick typed into the info string', () => {
		nativeEdit('```j`s\nconst x = 1\n```', 5);
		mounted.el.dispatchEvent(new Event('input', { bubbles: true }));

		expect(committed()).toBe('```js\nconst x = 1\n```');
	});

	// The IME path ends at the same commit, since `compositionend` calls the block's own
	// input handler, so a composed backtick is dropped like a typed one.
	it('reconciles what an IME composition leaves behind', () => {
		mounted.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		nativeEdit('```j`s\nconst x = 1\n```', 5);
		mounted.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

		expect(committed()).toBe('```js\nconst x = 1\n```');
	});

	it('commits an ordinary body edit untouched', () => {
		nativeEdit('```js\nconst x = 2\n```', 17);
		mounted.el.dispatchEvent(new Event('input', { bubbles: true }));

		expect(committed()).toBe('```js\nconst x = 2\n```');
	});
});
