/**
 * CodeBlock's edit paths take their text from the CST, never the rendered DOM (design
 * rule 1: CST wins) — a textContent-visible affix would make an `el.textContent` read
 * silently edit the wrong string. Scope is CodeBlock.svelte and READS only;
 * `code-renderer.ts` legitimately reads `textContent` while BUILDING its fragment. The
 * TS-shaped `stripComments` can over-blank a `.svelte` file, which only loses a
 * violation, never invents one.
 */

import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';

const CODE_BLOCK = 'components/blocks/code/CodeBlock.svelte';
// `.textContent` in any position except the left side of an assignment.
const TEXT_CONTENT_READ = /\.textContent\b(?!\s*=(?!=))/;

function textContentReads(code: string): string[] {
	return code.split('\n').filter((line) => TEXT_CONTENT_READ.test(line));
}

describe('CodeBlock takes its edit text from the CST, not the DOM', () => {
	const { code } = readEditorFile(CODE_BLOCK);

	it('read the CodeBlock source and found the paths this guard covers', () => {
		expect(code.length).toBeGreaterThan(0);
		expect(code).toContain('indentSelection');
		expect(code).toContain('dedentSelection');
	});

	it('no edit path reads textContent off the rendered element', () => {
		expect(
			textContentReads(code),
			`read the node through getDisplayText() instead, in ${CODE_BLOCK}`
		).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags the read shapes the fix removed', () => {
		expect(textContentReads("const t = el.textContent ?? '';")).toHaveLength(1);
		expect(textContentReads('indentLines(el.textContent ?? "", range)')).toHaveLength(1);
		expect(textContentReads('if (el.textContent === raw) return;')).toHaveLength(1);
		expect(textContentReads('return el.textContent')).toHaveLength(1);
	});

	it('matcher ignores a write and the accessor the reads were replaced with', () => {
		expect(textContentReads('el.textContent = text;')).toEqual([]);
		expect(textContentReads('const t = getDisplayText();')).toEqual([]);
	});
});
