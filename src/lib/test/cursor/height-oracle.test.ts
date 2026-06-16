import { describe, it, expect } from 'vitest';
import { createHeightOracle } from '../../cursor/height-oracle';
import type { CstNode } from '../../core/nodes';

const opts = { lineHeight: 24, codeLineHeight: 20, avgCharWidth: 8, blockChrome: 16 };

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
});
