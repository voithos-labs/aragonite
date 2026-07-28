/**
 * CodeBlock's edit paths take their text from the CST (`getDisplayText()` =
 * `trimTrailingLineEnding(node.raw)`), never from the rendered DOM. Design rule 1
 * is that CST wins when the two disagree, and `renderCodeBlock` + the trailing-
 * newline anchor are the only reason they agree today — a renderer change that
 * added a textContent-visible affix would make a `el.textContent` read silently
 * edit the wrong string.
 *
 * Tab/Shift+Tab were the last two paths reading the DOM while four siblings read
 * the node. This guard fails the day edit path N+1 reaches for the DOM again,
 * instead of at the next audit.
 *
 * Scope is CodeBlock.svelte alone. `code-renderer.ts` reads `child.textContent`
 * while BUILDING the fragment (there is no node to read at that point), and the
 * plain-text leaf backend edits its contenteditable in place by design — both are
 * legitimate and deliberately unscanned.
 *
 * READS only: a `.textContent = …` write is not matched. The renderer owns this
 * element through `replaceChildren`, so a write would be a different question
 * than the one this guard answers. `stripComments` is TS-shaped, so on a `.svelte`
 * file it can blank more than it should (a `//` inside the `<style>` block takes
 * the rest of that line); that can only make the scan miss a violation, never
 * invent one.
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
