/**
 * The island range gate's length has one source: the CST content range, carried as the
 * `ContentLength` brand. The brand seals the value; this scan seals the neighbourhood, so
 * a future gate under `decorations/` cannot grow a DOM measure of its own to compare
 * against — one that reads a container the render pass is still rewriting.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

const DECORATIONS_DIR = 'src/lib/decorations/';
const BRAND_HOME = 'src/lib/core/inline/index.ts';

/** Decoration modules permitted a DOM measure, each with the reason the CST cannot answer.
 *  A new entry is a new declared door; review it as one. */
const DOM_MEASURE_ALLOWLIST: Record<string, string> = {};

const DOM_MEASURES = [
	{ name: 'rendered-text length', re: /\b(?:textContent|innerText)\b[^;\n]{0,40}\.length\b/ },
	{ name: 'DOM text-length identifier', re: /\b\w*[Dd]omTextLength\b/ },
	{ name: 'walk read-back length', re: /\brawTextOfNode\s*\([^)]*\)\s*\.length\b/ }
] as const;

const CONTENT_LENGTH_CAST = /\bas\s+ContentLength\b/;

interface Measure {
	relPath: string;
	measure: string;
}

function domMeasuresIn(files: SourceFile[]): Measure[] {
	const found: Measure[] = [];
	for (const file of files) {
		if (file.relPath in DOM_MEASURE_ALLOWLIST) continue;
		for (const { name, re } of DOM_MEASURES) {
			if (re.test(file.code)) found.push({ relPath: file.relPath, measure: name });
		}
	}
	return found;
}

const synthetic = (relPath: string, text: string): SourceFile => ({
	relPath,
	text,
	code: stripComments(text)
});

describe('the island length gate reads the CST, never the DOM', () => {
	const sources = collectEditorSources();
	const decorationSources = sources.filter((f) => f.relPath.startsWith(DECORATIONS_DIR));

	it('found the decoration modules, so the scan is not measuring an empty tree', () => {
		expect(decorationSources.map((f) => f.relPath)).toContain(`${DECORATIONS_DIR}island-dom.ts`);
		expect(decorationSources.length).toBeGreaterThan(3);
	});

	it('no decoration module measures rendered text for a length', () => {
		expect(domMeasuresIn(decorationSources)).toEqual([]);
	});

	it('every allowlist entry still measures (no dead exemption)', () => {
		const byPath = new Map(decorationSources.map((f) => [f.relPath, f]));
		for (const relPath of Object.keys(DOM_MEASURE_ALLOWLIST)) {
			const file = byPath.get(relPath);
			expect(file, `allowlisted file not found: ${relPath}`).toBeDefined();
			const measured = DOM_MEASURES.some(({ re }) => re.test(file!.code));
			expect(measured, `allowlist stale for ${relPath}`).toBe(true);
		}
	});

	it('the ContentLength brand is cast only at its mint', () => {
		const casters = sources.filter((f) => CONTENT_LENGTH_CAST.test(f.code)).map((f) => f.relPath);
		expect(casters).toEqual([BRAND_HOME]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('a rogue decoration module measuring rendered text is flagged', () => {
		const rogue = synthetic(
			`${DECORATIONS_DIR}rogue.ts`,
			'const bound = (root.textContent ?? "").length;\nif (dec.end > bound) return;\n'
		);
		expect(domMeasuresIn([rogue])).toEqual([
			{ relPath: rogue.relPath, measure: 'rendered-text length' }
		]);
	});

	it('each measure shape is caught', () => {
		const shapes = [
			'const n = el.textContent.length;',
			'const n = containerDomTextLength(root);',
			'const n = rawTextOfNode(root, raw).length;'
		];
		for (const shape of shapes) {
			expect(domMeasuresIn([synthetic('x.ts', shape)]), shape).toHaveLength(1);
		}
	});

	it('island-count arithmetic and a commented measure stay clean', () => {
		const benign =
			'if (islands.length === 0) return [];\n' +
			'const displaced = rawTextOfNode(extracted, raw);\n' +
			'el.textContent = raw;\n' +
			'// root.textContent.length would be the wrong bound\n';
		expect(domMeasuresIn([synthetic('x.ts', benign)])).toEqual([]);
	});
});
