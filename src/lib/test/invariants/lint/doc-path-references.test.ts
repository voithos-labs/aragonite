/**
 * A backticked path in a design, contributing or requirement doc is a claim that the file exists,
 * and `check-codebase-map.mjs` resolves it so `npm run lint` fails when the file moves. These are
 * that reader's self-tests: a reader that finds nothing, or a resolver that says yes to
 * everything, would let the gate print a clean summary line over a dangling pointer.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
	referenceCorpus,
	referenceFailures,
	referencesIn,
	stripFencedBlocks
} from '../../../../../scripts/docs/check-codebase-map.mjs';
import { SOURCE } from './source-paths';

describe('path references: the corpus', () => {
	// Miss-analysis: the corpus was the design and contributing docs, so four requirement files
	// pointed at deleted or never-written tests with no gate reading them.
	it('reads the requirement files beside the design and contributing docs', () => {
		const corpus = referenceCorpus();
		expect(corpus).toContain('docs/design/editor.md');
		expect(corpus).toContain('docs/contributing/rules.md');
		expect(corpus).toContain('src/lib/e2e/requirements/selection/overlay.md');
	});
});

describe('path and symbol references: rooted', () => {
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

	// Miss-analysis: the reader resolved spans starting with a path only; no test gave it a command.
	it('reads the paths inside a backticked command, and nothing out of a plain word', () => {
		expect(referencesIn('d.md', '`npx vitest run src/lib/nope.test.ts`').references).toEqual([
			{ file: 'd.md', path: 'src/lib/nope.test.ts' }
		]);
		expect(referencesIn('d.md', 'Press `Mod+B` or run `npm test`.').references).toEqual([]);
	});

	it('reds on a missing file and on a symbol that file never names', () => {
		expect(referenceFailures([{ file: 'x.md', path: 'src/lib/nope.ts' }])).toEqual([
			'x.md: src/lib/nope.ts — no such file or directory'
		]);
		expect(
			referenceFailures([{ file: 'x.md', path: SOURCE.cstNodes, symbol: 'NotAThing' }])
		).toEqual([`x.md: ${SOURCE.cstNodes} :: NotAThing — symbol not found in that file`]);
		expect(
			referenceFailures([{ file: 'x.md', path: SOURCE.cstNodes, symbol: 'AnyBlockKind' }])
		).toEqual([]);
	});

	// Miss-analysis: resolution asked only whether the file was on disk, so a doc naming a local
	// record passed on the machine that had one and redded in CI.
	it('reds on a gitignored file that sits on disk', () => {
		const planted = 'scripts/zz-map-probe.d.mts';
		writeFileSync(planted, '');
		try {
			expect(referenceFailures([{ file: 'x.md', path: planted }])).toEqual([
				`x.md: ${planted} — gitignored, so it exists only on this machine`
			]);
		} finally {
			rmSync(planted);
		}
	});

	// Miss-analysis: a move left its old directory empty on disk, which git never checks out, so
	// the docs naming it passed locally and redded in CI.
	it('reds on an empty directory, which git does not keep', () => {
		const planted = 'scripts/zz-empty-dir-probe';
		mkdirSync(planted, { recursive: true });
		try {
			expect(referenceFailures([{ file: 'x.md', path: `${planted}/` }])).toEqual([
				`x.md: ${planted}/ — an empty directory, so a checkout doesn't have it`
			]);
		} finally {
			rmSync(planted, { recursive: true });
		}
	});

	it('blanks a fence, so an illustrative snippet claims nothing', () => {
		const blanked = stripFencedBlocks('Prose `src/a.ts`.\n```\n`src/nope.ts`\n```\nAfter.');
		expect(blanked).toContain('src/a.ts');
		expect(blanked).not.toContain('src/nope.ts');
	});
});

// Miss-analysis: only a span starting at a repo root was read, so `test/caret/…` (meaning
// `src/lib/test/…`) and bare test names outlived their files with no gate reading them.
describe('path and symbol references: written short', () => {
	it('reads a short path, a bare file name and one inside a command', () => {
		const { references } = referencesIn(
			'r.md',
			'Pinned by `test/caret/caret-writer-request.test.ts` and `overlay-remeasure.test.ts :: run` ' +
				'(`npx vitest run remeasure.test.ts`).'
		);
		expect(references).toEqual([
			{ file: 'r.md', path: 'test/caret/caret-writer-request.test.ts', symbol: undefined },
			{ file: 'r.md', path: 'overlay-remeasure.test.ts', symbol: 'run' },
			{ file: 'r.md', path: 'remeasure.test.ts' }
		]);
	});

	it('resolves one that ends a tree path, sits beside its citer, or holds a placeholder', () => {
		expect(
			referenceFailures([
				{ file: 'docs/design/x.md', path: 'test/browser/caret-writer-request.test.ts' },
				{ file: 'docs/design/x.md', path: 'remeasure.test.ts' },
				{ file: 'docs/contributing/x.md', path: '../design/editor.md' },
				{ file: 'docs/contributing/x.md', path: 'test/blocks/list/<name>.test.ts' },
				{ file: 'x.md', path: 'math-source.ts', symbol: 'sliceMathSource' }
			])
		).toEqual([]);
	});

	it('reds on one no tree path ends with, and on a symbol none of its files names', () => {
		expect(
			referenceFailures([
				{ file: 'x.md', path: 'test/caret/caret-writer-request.test.ts' },
				{ file: 'x.md', path: 'overlay-remeasure.test.ts' },
				{ file: 'docs/design/x.md', path: '../guide/nope.md' },
				{ file: 'x.md', path: 'math-source.ts', symbol: 'NotAThing' }
			])
		).toEqual([
			'x.md: test/caret/caret-writer-request.test.ts — no file in the tree ends with that path',
			'x.md: overlay-remeasure.test.ts — no file in the tree ends with that path',
			'docs/design/x.md: ../guide/nope.md — no file in the tree ends with that path',
			'x.md: math-source.ts :: NotAThing — symbol not found in any file that path names'
		]);
	});

	it('leaves a file inside an installed package to the package', () => {
		expect(referenceFailures([{ file: 'x.md', path: 'katex/dist/katex.min.css' }])).toEqual([]);
	});

	// `mermaid` is a root dependency and `packages/mermaid` alike, so the tree is asked first.
	it('still checks a tree path whose first segment shares a dependency’s name', () => {
		expect(
			referenceFailures([{ file: 'x.md', path: 'mermaid/src/renderer.ts', symbol: 'NotAThing' }])
		).toEqual([
			'x.md: mermaid/src/renderer.ts :: NotAThing — symbol not found in any file that path names'
		]);
	});
});
