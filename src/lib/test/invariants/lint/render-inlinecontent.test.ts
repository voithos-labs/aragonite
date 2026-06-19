/**
 * G4.2 — the prose render path must never read `node.inlineContent`. The render
 * effect re-parses `node.raw` locally; reading the cache during render once
 * closed a read/write loop that corrupted keyed-`{#each}` index assignment
 * after splitBlock (editor.md § Reactive State Plumbing). Non-render consumers
 * (event handlers, exported methods, click-snap) may read it — so this scan is
 * scoped to the render path only: the DOM-build file plus the render `$effect`.
 */

import { describe, it, expect } from 'vitest';
import { readEditorFile, stripComments } from './scan-source';

const RENDER_DOM_FILE = 'components/blocks/text/text-render.ts';
const TEXT_BLOCK_FILE = 'components/blocks/text/TextEditableBlock.svelte';
const CELL_RENDER_FILE = 'components/blocks/table/cell-render.ts';
const CELL_BLOCK_FILE = 'components/blocks/table/TableCellBlock.svelte';

function readsInlineContent(code: string): boolean {
	return /\.inlineContent\b/.test(code);
}

/**
 * Extract a render `$effect` block by anchoring on its render dispatch (e.g.
 * `textRender.render`), walking back to the enclosing `$effect(`, and
 * brace-matching to its close. Returns null if the anchor is absent — callers
 * must treat null as a hard failure so a rename can't silently disable the scan.
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

describe('G4.2 no .inlineContent read in the render path', () => {
	it('text-render.ts (whole render DOM-build file) does not read .inlineContent', () => {
		const file = readEditorFile(RENDER_DOM_FILE);
		expect(file.text.length).toBeGreaterThan(0);
		expect(readsInlineContent(file.code)).toBe(false);
	});

	it('TextEditableBlock render $effect does not read .inlineContent', () => {
		const file = readEditorFile(TEXT_BLOCK_FILE);
		const effect = extractRenderEffect(file.text);
		// Fail loud if the anchor vanished (rename/refactor) — a silent pass would
		// leave the render path unguarded.
		expect(effect, 'render $effect anchor "textRender.render" not found').not.toBeNull();
		expect(readsInlineContent(effect!)).toBe(false);
	});

	it('cell-render.ts (whole render DOM-build file) does not read .inlineContent', () => {
		const file = readEditorFile(CELL_RENDER_FILE);
		expect(file.text.length).toBeGreaterThan(0);
		expect(readsInlineContent(file.code)).toBe(false);
	});

	it('TableCellBlock render $effect does not read .inlineContent', () => {
		const file = readEditorFile(CELL_BLOCK_FILE);
		const effect = extractRenderEffect(file.text, 'cellRender.render');
		expect(effect, 'cell render $effect anchor "cellRender.render" not found').not.toBeNull();
		expect(readsInlineContent(effect!)).toBe(false);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('readsInlineContent flags a synthetic render read', () => {
		expect(readsInlineContent('el.replaceChildren(build(node.inlineContent));')).toBe(true);
		expect(readsInlineContent('const c = parseInline(node.raw, range.start, range.end);')).toBe(
			false
		);
	});

	it('extractRenderEffect isolates the effect and would catch a read inside it', () => {
		const bad =
			'const x = node.inlineContent;\n' + // outside the effect — must be ignored
			'$effect(() => {\n  textRender.render();\n  const c = node.inlineContent;\n});\n';
		const effect = extractRenderEffect(bad);
		expect(effect).not.toBeNull();
		expect(readsInlineContent(effect!)).toBe(true);
		// The leading read outside the effect is excluded from the extracted block.
		expect(effect!.includes('const x')).toBe(false);
	});

	it('extractRenderEffect returns null when the anchor is missing', () => {
		expect(extractRenderEffect('$effect(() => { doSomethingElse(); });')).toBeNull();
	});

	it('extractRenderEffect ignores an anchor that only appears in a comment', () => {
		expect(extractRenderEffect('// textRender.render is dispatched elsewhere\n')).toBeNull();
	});
});
