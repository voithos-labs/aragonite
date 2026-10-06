/**
 * The prose render path computes inline content through the pure `computeInlineContent`, never
 * the caching accessor (G4.2): the cache is a non-reactive WeakMap, so a render reading it would
 * miss changes the pure compute sees. Non-render consumers may use the accessor, hence the scope:
 * the DOM-build file plus the render `$effect`.
 */

import { describe, it, expect } from 'vitest';
import { balancedRegion, readSource, sourceFile, type SourceFile } from './scan-source';
import { SOURCE } from './source-paths';

const RENDER_DOM_FILE = SOURCE.textRender;
const TEXT_BLOCK_FILE = SOURCE.textBlock;
const CELL_RENDER_FILE = SOURCE.cellRender;
const CELL_BLOCK_FILE = SOURCE.tableCell;

function callsCachingAccessor(code: string): boolean {
	return /\bgetInlineContent\b/.test(code);
}

/** A render `$effect` block, found by its render dispatch, or null when the anchor is absent;
 *  callers must fail on null, or a rename silently disables the scan. */
export function extractRenderEffect(
	{ code }: SourceFile,
	anchor = 'textRender.render'
): string | null {
	const anchorAt = code.indexOf(anchor);
	if (anchorAt === -1) return null;

	const effectStart = code.lastIndexOf('$effect(', anchorAt);
	if (effectStart === -1) return null;

	const braceOpen = code.indexOf('{', effectStart);
	if (braceOpen === -1 || braceOpen > anchorAt) return null;
	return balancedRegion(code, braceOpen);
}

describe('G4.2 render path computes inline, never the caching accessor', () => {
	it('text-render.ts (whole render DOM-build file) does not call getInlineContent', () => {
		const file = readSource(RENDER_DOM_FILE);
		expect(file.text.length).toBeGreaterThan(0);
		expect(callsCachingAccessor(file.code)).toBe(false);
	});

	it('TextEditableBlock render $effect does not call getInlineContent', () => {
		const file = readSource(TEXT_BLOCK_FILE);
		const effect = extractRenderEffect(file);
		// Fail loud if the anchor vanished: a silent pass leaves the render path unguarded.
		expect(effect, 'render $effect anchor "textRender.render" not found').not.toBeNull();
		expect(callsCachingAccessor(effect!)).toBe(false);
	});

	it('cell-render.ts (whole render DOM-build file) does not call getInlineContent', () => {
		const file = readSource(CELL_RENDER_FILE);
		expect(file.text.length).toBeGreaterThan(0);
		expect(callsCachingAccessor(file.code)).toBe(false);
	});

	it('TableCellBlock render $effect does not call getInlineContent', () => {
		const file = readSource(CELL_BLOCK_FILE);
		const effect = extractRenderEffect(file, 'cellRender.render');
		expect(effect, 'cell render $effect anchor "cellRender.render" not found').not.toBeNull();
		expect(callsCachingAccessor(effect!)).toBe(false);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('callsCachingAccessor flags a synthetic render call', () => {
		expect(callsCachingAccessor('el.replaceChildren(build(getInlineContent(node)));')).toBe(true);
		expect(callsCachingAccessor('const c = computeInlineContent(node, resolver);')).toBe(false);
	});

	const probe = (text: string) => sourceFile('probe.ts', text);

	it('extractRenderEffect isolates the effect and would catch a call inside it', () => {
		const bad =
			'const x = getInlineContent(node);\n' + // outside the effect — must be ignored
			'$effect(() => {\n  textRender.render();\n  const c = getInlineContent(node);\n});\n';
		const effect = extractRenderEffect(probe(bad));
		expect(effect).not.toBeNull();
		expect(callsCachingAccessor(effect!)).toBe(true);
		// The leading call outside the effect is excluded from the extracted block.
		expect(effect!.includes('const x')).toBe(false);
	});

	it('extractRenderEffect reads past a brace inside a string or a comment', () => {
		const effect = extractRenderEffect(
			probe(
				"$effect(() => {\n  const close = '}'; // }\n  textRender.render();\n  getInlineContent(node);\n});\n"
			)
		);
		expect(callsCachingAccessor(effect!)).toBe(true);
	});

	it('extractRenderEffect returns null when the anchor is missing', () => {
		expect(extractRenderEffect(probe('$effect(() => { doSomethingElse(); });'))).toBeNull();
	});

	it('extractRenderEffect ignores an anchor that only appears in a comment', () => {
		expect(extractRenderEffect(probe('// textRender.render is dispatched elsewhere\n'))).toBeNull();
	});
});
