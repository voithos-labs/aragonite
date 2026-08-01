// @vitest-environment jsdom
//
// A CRLF document must never gain a lone LF before the user has typed anything (G4.20).
// A blank line is a block of its own, so a blank source arrives carrying its own endings
// and only the truly empty source reaches the caret placeholder.
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

describe('Editor mount leaves a blank source alone', () => {
	it.each([
		['CRLF', '\r\n'],
		['LF', '\n']
	])('a blank %s source mounts unchanged — its blank line is already a block', (_label, src) => {
		expect(sourceAfterMount(src)).toBe(src);
	});

	it('an empty source gains the LF caret placeholder', () => {
		expect(sourceAfterMount('')).toBe('\n');
	});
});
