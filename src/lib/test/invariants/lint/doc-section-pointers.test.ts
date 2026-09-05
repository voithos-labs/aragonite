/**
 * A comment naming `<doc>.md § Section` is a claim about a heading, and `check-codebase-map.mjs`
 * resolves it so `npm run lint` reds when the heading is renamed. This is that reader's
 * non-vacuity half: a corpus that came back empty, a heading index that found no headings, or a
 * matcher that says yes to everything would each let the gate pass on nothing, and the same
 * restructure could quietly lobotomize the path and symbol checks that share the script.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	citingFiles,
	headingKeys,
	headingsOf,
	pointersIn,
	referenceFailures,
	referencesIn,
	resolvesAgainst,
	sectionFragment,
	stripFencedBlocks
} from '../../../../../scripts/check-codebase-map.mjs';

const ROOTS = ['src', 'docs', 'scripts', 'examples', 'README.md', 'CONTRIBUTING.md'];

const files = citingFiles(ROOTS);
const pointers = files.flatMap((file) => pointersIn(file, readFileSync(file, 'utf8')));

// ── The corpus ───────────────────────────────────────────────────────────────

describe('§ pointer corpus — non-vacuity', () => {
	it('reaches every file kind a pointer is cited from', () => {
		expect(files.length).toBeGreaterThan(1000);
		for (const ext of ['.ts', '.svelte', '.md']) {
			expect(files.filter((file) => file.endsWith(ext)).length, `no ${ext} file`).toBeGreaterThan(
				0
			);
		}
	});

	it('drops the gitignored working area and the gitignored contributing docs', () => {
		expect(files.some((file) => file.startsWith('docs/superpowers/'))).toBe(false);
		expect(files).not.toContain('docs/contributing/releasing.md');
		expect(files).toContain('docs/contributing/rules.md');
	});

	it('finds the pointers it exists to check', () => {
		expect(pointers.length).toBeGreaterThan(100);
		const activation = pointers.filter(
			(pointer) => pointer.file === 'src/lib/schema/plugin-activation.ts'
		);
		expect(activation).toHaveLength(1);
		expect(activation[0].doc).toBe('docs/design/plugin-contract.md');
		expect(activation[0].fragment).toBe('per-instance-enablement');
	});
});

// ── The matcher ──────────────────────────────────────────────────────────────

describe('§ pointer resolution — self-tests', () => {
	const editorHeadings = headingsOf(readFileSync('docs/design/editor.md', 'utf8'));

	it('indexes a real doc rather than an empty heading set', () => {
		expect(editorHeadings.size).toBeGreaterThan(20);
		expect(editorHeadings).toContain('reactive-state-plumbing-svelte-5');
	});

	it('reads a heading under every spelling a citer writes it', () => {
		expect([...headingKeys('11. Undo / redo')].sort()).toEqual(['11', '11-undo-redo', 'undo-redo']);
		expect(headingKeys('Reactive state plumbing (Svelte 5)')).toContain('reactive-state-plumbing');
		expect(headingKeys('The bug shape to fear: sibling-path parity')).toContain(
			'sibling-path-parity'
		);
	});

	it('bounds the name at its quote, its parenthesis, or its number', () => {
		expect(sectionFragment('The gap caret) and the caret after it')).toBe('the-gap-caret');
		expect(sectionFragment('"Merge eligibility: roles, not pairs" says which')).toBe(
			'merge-eligibility-roles-not-pairs'
		);
		expect(sectionFragment('4.4 close-and-reopen): Enter inside a construct')).toBe('4-4');
		// A markdown link's anchor half is the pointer, and the docs-link gate owns that.
		expect(sectionFragment('[Working the gates](rules.md#working-the-gates)')).toBeNull();
		expect(sectionFragment('E2E tests](testing.md#e2e-tests-playwright) has the ports')).toBe(
			'e2e-tests'
		);
	});

	it('tolerates a qualifier the citer dropped and prose that runs on after the name', () => {
		expect(resolvesAgainst(editorHeadings, 'reactive-state-plumbing')).toBe(true);
		expect(resolvesAgainst(editorHeadings, 'reactive-state-plumbing-carries-the-incident')).toBe(
			true
		);
		expect(resolvesAgainst(editorHeadings, 'the-gap-caret')).toBe(true);
		expect(resolvesAgainst(editorHeadings, 'undo-redo')).toBe(true);
	});

	// The pair this gate was filed for: one heading the doc carries, one it only sounds like.
	it('separates a heading a doc has from a name it never had', () => {
		const contract = headingsOf(readFileSync('docs/design/plugin-contract.md', 'utf8'));
		expect(resolvesAgainst(contract, 'per-instance-enablement')).toBe(true);
		expect(resolvesAgainst(contract, 'schema-registries')).toBe(false);
	});

	it('reds when the heading a live pointer names is renamed', () => {
		const source = readFileSync('src/lib/components/Editor.svelte', 'utf8');
		const cited = pointersIn('src/lib/components/Editor.svelte', source).find((pointer) =>
			pointer.doc.endsWith('editor.md')
		);
		expect(cited, 'Editor.svelte no longer cites an editor.md section').toBeDefined();
		expect(resolvesAgainst(editorHeadings, cited!.fragment)).toBe(true);
		const renamed = readFileSync('docs/design/editor.md', 'utf8').replace(
			/^### Reactive state plumbing .*$/m,
			'### Wiring the runes'
		);
		expect(resolvesAgainst(headingsOf(renamed), cited!.fragment)).toBe(false);
	});
});

// ── The checks that share the script ─────────────────────────────────────────
// The § reader was added beside these, and a restructure that broke them would still print a
// clean summary line.

describe('path and symbol references — still enforced', () => {
	it('parses both spellings of a reference out of a doc', () => {
		const { references, malformed } = referencesIn(
			'x.md',
			'A seam at `src/lib/core/nodes.ts` :: `AnyBlockKind`, and `docs/README.md`.'
		);
		expect(references).toEqual([
			{ file: 'x.md', path: 'src/lib/core/nodes.ts', symbol: 'AnyBlockKind' },
			{ file: 'x.md', path: 'docs/README.md', symbol: undefined }
		]);
		expect(malformed).toEqual([]);
	});

	it('reds on a missing file and on a symbol that file never names', () => {
		expect(referenceFailures([{ file: 'x.md', path: 'src/lib/nope.ts' }])).toEqual([
			'x.md: src/lib/nope.ts — no such file or directory'
		]);
		expect(
			referenceFailures([{ file: 'x.md', path: 'src/lib/core/nodes.ts', symbol: 'NotAThing' }])
		).toEqual(['x.md: src/lib/core/nodes.ts :: NotAThing — symbol not found in that file']);
		expect(
			referenceFailures([{ file: 'x.md', path: 'src/lib/core/nodes.ts', symbol: 'AnyBlockKind' }])
		).toEqual([]);
	});

	it('blanks a fence, so an illustrative snippet claims nothing', () => {
		const blanked = stripFencedBlocks('Prose `src/a.ts`.\n```\n`src/nope.ts`\n```\nAfter.');
		expect(blanked).toContain('src/a.ts');
		expect(blanked).not.toContain('src/nope.ts');
	});
});
