/**
 * The parseBlocks window seam's contract: a window whose boundaries fall on block starts
 * parses identically to a full parse of the window's text.
 */
import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../../core/parser';
import { splitLines } from '../../core/lines';

function flat(r: ReturnType<typeof parseBlocks>): string {
	return r.prefix + r.children.map((c) => c.leadingTrivia + c.raw).join('') + r.suffix;
}

function expectWindowEqualsSliceParse(source: string, start: number, end: number): void {
	const lines = splitLines(source);
	const windowed = parseBlocks(lines, start, end);
	const sliceText = lines
		.slice(start, end)
		.map((l) => l.raw)
		.join('');
	const sliceLines = splitLines(sliceText);
	const full = parseBlocks(sliceLines, 0, sliceLines.length);

	expect(flat(windowed)).toBe(sliceText);
	expect(flat(windowed)).toBe(flat(full));
	expect(windowed.children.map((c) => c.kind)).toEqual(full.children.map((c) => c.kind));
	expect(windowed.children.map((c) => c.leadingTrivia + c.raw)).toEqual(
		full.children.map((c) => c.leadingTrivia + c.raw)
	);
}

const source = '# head\n\npara one\n\n- item a\n- item b\n\n```js\ncode();\n```\n\ntail para\n';
const lines = splitLines(source);
const lineAt = (prefix: string) => lines.findIndex((l) => l.text.startsWith(prefix));

describe('parseBlocks window contract', () => {
	it('mid-document block-aligned window equals full parse of the slice', () => {
		expectWindowEqualsSliceParse(source, lineAt('- item a'), lineAt('tail para'));
	});

	it('window starting at line 0', () => {
		expectWindowEqualsSliceParse(source, 0, lineAt('- item a'));
	});

	it('window ending at lines.length', () => {
		expectWindowEqualsSliceParse(source, lineAt('```js'), lines.length);
	});

	it('window covering a single list container', () => {
		expectWindowEqualsSliceParse(source, lineAt('- item a'), lineAt('```js'));
	});

	it('window covering a single blockquote container', () => {
		const quoted = 'before\n\n> quote one\n> quote two\n\nafter\n';
		const qLines = splitLines(quoted);
		const qStart = qLines.findIndex((l) => l.text.startsWith('> quote one'));
		const qEnd = qLines.findIndex((l) => l.text.startsWith('after'));
		expectWindowEqualsSliceParse(quoted, qStart, qEnd);
	});
});
