/**
 * G4.30 — hidden-run classification has one home. Which marker text a mode paints nothing
 * for is decided in `cursor/widget-offset.ts` alone: a second copy would disagree the day a
 * mode or a reveal rule moved, and a caret seated in unpainted text corrupts silently. The
 * vocabulary census is the second arm — a file that starts naming marker classes is a
 * decision, not a drift.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';

const CLASSIFICATION_HOME = 'src/lib/cursor/widget-offset.ts';

/** A DOM read that resolves marker-hiding state: the mode root, the block-focus stamp, the
 *  construct stamp, or a marker class tested by selector. */
const CLASSIFICATION_RE =
	/(?:classList\.contains|closest|matches|querySelector(?:All)?)\s*\(\s*['"`][^'"`]*(?:md-marker|md-fence-line|md-ref-label|md-construct-reveal|data-construct-|data-presentation|data-focused)|(?:get|has)Attribute\s*\(\s*['"`]data-(?:presentation|construct-|focused)/;

/** Files reading that vocabulary for a DIFFERENT question, each saying which. */
const NON_CLASSIFYING_READERS: Record<string, string> = {
	'src/lib/ambient/ambient-dom.ts':
		'ambient span identity — a contenteditable="false" marker keeps its box, so the hidden-run rule excludes it by construction',
	'src/lib/components/blocks/text/construct-reveal.ts':
		'preview-inline reveal writer — it stamps the class the classification reads, and asks nothing about hiding',
	'src/lib/core/inline-render.ts':
		"reads back the marker spans it just minted, in the same call that minted them (renderedText) — the mint's own inverse, and it asks nothing about which MODE paints them"
};

const MARKER_CLASSES = [
	'md-marker',
	'md-fence-line',
	'md-ref-label',
	'md-construct-reveal',
	'directive-marker'
];

/** Every file naming a marker class in code, and its role. */
const MARKER_CLASS_FILES: Record<string, string> = {
	'src/lib/cursor/widget-offset.ts': 'the classification home',
	'src/lib/components/blocks/directive/DirectiveContainerBlock.svelte':
		'mints the directive container chrome — contenteditable="false" AND outside every walk container, so the hiding classification excludes it twice over',
	'src/lib/ambient/ambient-dom.ts': 'mints and identifies the ambient span',
	'src/lib/core/inline-render.ts': 'mints inline marker and ref-label spans',
	'src/lib/components/blocks/text/text-render.ts': 'mints the block-own prefix span',
	'src/lib/components/blocks/code/code-renderer.ts': 'mints fence marker and fence-line spans',
	'src/lib/components/blocks/text/construct-reveal.ts': 'flips the reveal class'
};

/** A component's own CSS is the stylesheet half of this contract, not a second reader. */
function codeOutsideStyleBlocks(file: SourceFile): string {
	return file.code.replace(/<style[\s\S]*?<\/style>/g, '');
}

describe('G4.30 hidden-run classification', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('only the one home resolves marker-hiding state', () => {
		const readers = sources
			.filter((f) => CLASSIFICATION_RE.test(codeOutsideStyleBlocks(f)))
			.map((f) => f.relPath)
			.sort();
		expect(
			readers,
			'a file started reading the mode/reveal/marker vocabulary: route the question through ' +
				'widget-offset.ts, or add it to NON_CLASSIFYING_READERS saying what else it asks'
		).toEqual([CLASSIFICATION_HOME, ...Object.keys(NON_CLASSIFYING_READERS)].sort());
	});

	it('each non-classifying reader still reads the vocabulary (no dead entry)', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const [relPath, why] of Object.entries(NON_CLASSIFYING_READERS)) {
			const file = byPath.get(relPath);
			expect(file, `reader not found: ${relPath}`).toBeDefined();
			expect(CLASSIFICATION_RE.test(codeOutsideStyleBlocks(file!)), `stale entry (${why})`).toBe(
				true
			);
		}
	});

	it('every file naming a marker class is manifested with its role', () => {
		const naming = sources
			.filter((f) => MARKER_CLASSES.some((cls) => codeOutsideStyleBlocks(f).includes(cls)))
			.map((f) => f.relPath)
			.sort();
		expect(
			naming,
			'a file started naming marker classes: add it to MARKER_CLASS_FILES with its role'
		).toEqual(Object.keys(MARKER_CLASS_FILES).sort());
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the classification matcher flags every shape the home uses', () => {
		for (const shape of [
			"container.closest('[data-presentation]')",
			"el.getAttribute('data-presentation')",
			"el.closest('.block-host[data-focused]')",
			"el.hasAttribute('data-construct-start')",
			"el.classList.contains('md-construct-reveal')",
			"node.matches('.md-ref-label')"
		]) {
			expect(CLASSIFICATION_RE.test(shape), shape).toBe(true);
		}
	});

	it('the classification matcher ignores unrelated DOM reads and stylesheet selectors', () => {
		expect(CLASSIFICATION_RE.test("el.closest('.block-host')")).toBe(false);
		expect(CLASSIFICATION_RE.test("el.getAttribute('data-source-start')")).toBe(false);
		const styled = {
			relPath: 'x.svelte',
			text: '',
			code: '<style>:global(.md-marker) { display: none; }</style>'
		};
		expect(codeOutsideStyleBlocks(styled).includes('md-marker')).toBe(false);
	});
});
