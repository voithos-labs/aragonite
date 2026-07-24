// @vitest-environment jsdom
//
// A source that is nothing but blank lines parses to zero blocks, so mount
// materializes a caret placeholder. That placeholder IS a line ending (G4.20) —
// a defaulted `\n` puts a lone LF into a CRLF document before the user has typed
// anything, and every later edit inherits it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Editor from '$lib/components/Editor.svelte';
import type { EditorInstance } from '$lib/editor-props';

beforeAll(() => {
	// BlockHost measures its own height; jsdom has no layout.
	(globalThis as any).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
	Element.prototype.scrollIntoView = () => {};
});

let mounted: EditorInstance | null = null;
let target: HTMLElement | null = null;

afterEach(() => {
	if (mounted) void unmount(mounted);
	target?.remove();
	mounted = null;
	target = null;
});

function sourceAfterMount(source: string): string {
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(Editor, { target, props: { source } }) as EditorInstance;
	flushSync();
	return mounted.getSource();
}

describe('Editor mount placeholder takes the source line ending', () => {
	it('a blank CRLF source keeps CRLF', () => {
		expect(sourceAfterMount('\r\n')).toBe('\r\n\r\n');
	});

	it('an empty source is unchanged (LF placeholder)', () => {
		expect(sourceAfterMount('')).toBe('\n');
	});
});
