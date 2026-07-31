/**
 * G4.2 (perf-hygiene) — the prose render path computes inline content via the pure
 * `computeInlineContent`, never the caching accessor. The cache is a non-reactive
 * WeakMap, so a render reading it would skip render-relevant changes the pure compute
 * always sees. Non-render consumers may use the accessor, hence the scope: the DOM-build
 * file plus the render `$effect`.
 */

import { describe, it, expect } from 'vitest';
import { readEditorFile, stripComments } from './scan-source';

const RENDER_DOM_FILE = 'components/blocks/text/text-render.ts';
const TEXT_BLOCK_FILE = 'components/blocks/text/TextEditableBlock.svelte';
const CELL_RENDER_FILE = 'components/blocks/table/cell-render.ts';
const CELL_BLOCK_FILE = 'components/blocks/table/TableCellBlock.svelte';

function callsCachingAccessor(code: string): boolean {
	return /\bgetInlineContent\b/.test(code);
}

/**
 * Extract a render `$effect` block by anchoring on its render dispatch. Returns null if
 * the anchor is absent; callers must treat that as a hard failure, or a rename silently
 * disables the scan.
 */
export function extractRenderEffect(rawText: string, anchor = 'textRender.render'): string | null {
	const code = stripComments(rawText);
	const anchorAt = code.indexOf(anchor);
	if (anchorAt === -1) return null;

	const effectStart = code.lastIndexOf('$effect(', anchorAt);
	if (effectStart === -1) return null;

	const braceOpen = code.indexOf('{', effectStart);
	if (braceOpen === -1 || braceOpen > anchorAt) return null;

	let depth = 0;
	for (let i = braceOpen; i < code.length; i++) {
		if (code[i] === '{') depth++;
		else if (code[i] === '}') {
			depth--;
			if (depth === 0) return code.slice(braceOpen, i + 1);
		}
	}
	return null;
}

describe('G4.2 render path computes inline, never the caching accessor', () => {
	it('text-render.ts (whole render DOM-build file) does not call getInlineContent', () => {
		const file = readEditorFile(RENDER_DOM_FILE);
		expect(file.text.length).toBeGreaterThan(0);
		expect(callsCachingAccessor(file.code)).toBe(false);
	});

	it('TextEditableBlock render $effect does not call getInlineContent', () => {
		const file = readEditorFile(TEXT_BLOCK_FILE);
		const effect = extractRenderEffect(file.text);
		// Fail loud if the anchor vanished: a silent pass leaves the render path unguarded.
		expect(effect, 'render $effect anchor "textRender.render" not found').not.toBeNull();
		expect(callsCachingAccessor(effect!)).toBe(false);
	});

	it('cell-render.ts (whole render DOM-build file) does not call getInlineContent', () => {
		const file = readEditorFile(CELL_RENDER_FILE);
		expect(file.text.length).toBeGreaterThan(0);
		expect(callsCachingAccessor(file.code)).toBe(false);
	});

	it('TableCellBlock render $effect does not call getInlineContent', () => {
		const file = readEditorFile(CELL_BLOCK_FILE);
		const effect = extractRenderEffect(file.text, 'cellRender.render');
		expect(effect, 'cell render $effect anchor "cellRender.render" not found').not.toBeNull();
		expect(callsCachingAccessor(effect!)).toBe(false);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('callsCachingAccessor flags a synthetic render call', () => {
		expect(callsCachingAccessor('el.replaceChildren(build(getInlineContent(node)));')).toBe(true);
		expect(callsCachingAccessor('const c = computeInlineContent(node, resolver);')).toBe(false);
	});

	it('extractRenderEffect isolates the effect and would catch a call inside it', () => {
		const bad =
			'const x = getInlineContent(node);\n' + // outside the effect — must be ignored
			'$effect(() => {\n  textRender.render();\n  const c = getInlineContent(node);\n});\n';
		const effect = extractRenderEffect(bad);
		expect(effect).not.toBeNull();
		expect(callsCachingAccessor(effect!)).toBe(true);
		// The leading call outside the effect is excluded from the extracted block.
		expect(effect!.includes('const x')).toBe(false);
	});

	it('extractRenderEffect returns null when the anchor is missing', () => {
		expect(extractRenderEffect('$effect(() => { doSomethingElse(); });')).toBeNull();
	});

	it('extractRenderEffect ignores an anchor that only appears in a comment', () => {
		expect(extractRenderEffect('// textRender.render is dispatched elsewhere\n')).toBeNull();
	});
});
