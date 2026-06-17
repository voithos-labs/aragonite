import { describe, it, expect } from 'vitest';
import { createHeightOracle } from '../../cursor/height-oracle';
import type { CstNode } from '../../core/nodes';

const opts = {
	lineHeight: 24,
	codeLineHeight: 20,
	avgCharWidth: 8,
	blockChrome: 16,
	imageBlockMinHeight: 200
};

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

describe('createHeightOracle', () => {
	it('estimates a short paragraph as one line plus chrome', () => {
		const o = createHeightOracle(opts);
		// width 800 / avgCharWidth 8 = 100 chars/line; "hello" wraps to 1 line.
		expect(o.estimate(para('hello'), 800)).toBe(24 + 16);
	});

	it('estimates a long paragraph as multiple wrapped lines', () => {
		const o = createHeightOracle(opts);
		// 250 chars / 100 per line = 3 lines.
		expect(o.estimate(para('x'.repeat(250)), 800)).toBe(24 * 3 + 16);
	});

	it('estimates fenced code by newline count, not wrap', () => {
		const o = createHeightOracle(opts);
		const code: CstNode = { kind: 'fencedCode', leadingTrivia: '', raw: '```\na\nb\n```\n' };
		// 4 source lines at codeLineHeight + chrome.
		expect(o.estimate(code, 800)).toBe(20 * 4 + 16);
	});

	it('measured height supersedes the estimate; height() prefers it', () => {
		const o = createHeightOracle(opts);
		const node = para('hello');
		o.recordMeasured('id-1', 99);
		expect(o.measured('id-1')).toBe(99);
		expect(o.height('id-1', node, 800)).toBe(99);
		expect(o.height('id-2', node, 800)).toBe(24 + 16); // no measurement -> estimate
	});

	it('invalidateWidth clears measured heights (wrap depends on width)', () => {
		const o = createHeightOracle(opts);
		o.recordMeasured('id-1', 99);
		o.invalidateWidth();
		expect(o.measured('id-1')).toBeUndefined();
	});

	// table/tableRow are the only arm combining sourceLines with the prose
	// lineHeight — a refactor folding it into the default (wrapped) arm ships
	// silently without this guard.
	it('estimates table and tableRow by source-line count at prose line height', () => {
		const o = createHeightOracle(opts);
		const table: CstNode = { kind: 'table', leadingTrivia: '', raw: 'a|b\n-|-\nc|d\n' };
		expect(o.estimate(table, 800)).toBe(24 * 3 + 16);
		const row: CstNode = { kind: 'tableRow', leadingTrivia: '', raw: 'a|b\n' };
		expect(o.estimate(row, 800)).toBe(24 * 1 + 16);
	});

	// Guards the module's central claim: containers fall through to the default
	// wrapped arm using raw.length (materialized container raw), not a per-kind arm.
	it('estimates a container by raw length via the default wrapped arm', () => {
		const o = createHeightOracle(opts);
		const quote: CstNode = { kind: 'blockquote', leadingTrivia: '', raw: 'x'.repeat(250) };
		expect(o.estimate(quote, 800)).toBe(24 * 3 + 16);
	});

	it('counts source lines with the trailing-newline correction', () => {
		const o = createHeightOracle(opts);
		const empty: CstNode = { kind: 'indentedCode', leadingTrivia: '', raw: '' };
		expect(o.estimate(empty, 800)).toBe(20 * 1 + 16); // empty -> floored at 1 line
		const noTrailing: CstNode = { kind: 'indentedCode', leadingTrivia: '', raw: 'a\nb' };
		expect(o.estimate(noTrailing, 800)).toBe(20 * 2 + 16); // 2 lines, no phantom trailing line
	});

	it('estimates a thematic break as a constant, independent of raw and width', () => {
		const o = createHeightOracle(opts);
		const hr: CstNode = { kind: 'thematicBreak', leadingTrivia: '', raw: '---\n' };
		expect(o.estimate(hr, 800)).toBe(24 + 16);
		expect(o.estimate(hr, 200)).toBe(24 + 16);
	});

	// A rendered image is far taller than its `![alt](url)` source, so the char-based
	// estimate would seed an image-only paragraph at ~1 line and a screenful of images
	// undercounts to near-zero. The floor keeps the estimate honest enough for
	// activation/spacers. Without it the estimate collapses to one line + chrome.
	it('floors an image-bearing paragraph at imageBlockMinHeight', () => {
		const o = createHeightOracle(opts);
		const img: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '![A photo|400](pic.png)' };
		const oneLine = 24 + 16;
		expect(o.estimate(img, 800)).toBe(200); // floored, not the ~40px char estimate
		expect(o.estimate(img, 800)).toBeGreaterThan(oneLine);
	});

	it('keeps the prose estimate when an image paragraph already exceeds the floor', () => {
		const o = createHeightOracle(opts);
		// Long caption around the image wraps to > 200px on its own; floor doesn't apply.
		const wide: CstNode = {
			kind: 'paragraph',
			leadingTrivia: '',
			raw: '![x](pic.png) ' + 'word '.repeat(300)
		};
		expect(o.estimate(wide, 800)).toBeGreaterThan(200);
	});

	it('does not floor a plain paragraph without an image', () => {
		const o = createHeightOracle(opts);
		expect(o.estimate(para('hello'), 800)).toBe(24 + 16); // unfloored short prose
	});

	it('clear() empties the measured cache', () => {
		const o = createHeightOracle(opts);
		o.recordMeasured('id-1', 99);
		o.clear();
		expect(o.measured('id-1')).toBeUndefined();
	});
});
