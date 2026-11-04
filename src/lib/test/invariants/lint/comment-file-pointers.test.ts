/**
 * A file a library or bundled-plugin comment names in backticks exists, by the docs' own rule
 * (`scripts/docs/check-codebase-map.mjs` :: `referenceFailures`). Test, script and route comments
 * stay out: they name the files a self-test plants (`probe.ts`) and build outputs, which measured
 * eight false hits for every three real ones, too many to keep an allowlist of planted names.
 */
import { describe, it, expect } from 'vitest';
import {
	collectEditorSources,
	commentSpans,
	commentText,
	languageOf,
	LIBRARY_ROOTS
} from './scan-source';
import {
	readTree,
	referenceFailures,
	referencesIn
} from '../../../../../scripts/docs/check-codebase-map.mjs';

const tree = readTree();
const sources = collectEditorSources(LIBRARY_ROOTS);

function commentReferences(relPath: string, text: string) {
	const prose = commentSpans(text, languageOf(relPath))
		.flatMap((span) => commentText(text, span))
		.join('\n');
	return referencesIn(relPath, prose).references;
}

describe('a file a library comment names exists', () => {
	it('reads the library and the bundled plugins, and finds the files they name', () => {
		expect(sources.length).toBeGreaterThan(500);
		expect(sources.some((file) => file.relPath.startsWith('packages/'))).toBe(true);
		expect(sources.some((file) => /^src\/lib\/(test|e2e)\//.test(file.relPath))).toBe(false);
		const named = sources.flatMap((file) => commentReferences(file.relPath, file.text));
		expect(named.length).toBeGreaterThan(200);
	});

	it('names no file the tree lacks', () => {
		const failures = sources.flatMap((file) =>
			referenceFailures(commentReferences(file.relPath, file.text), tree)
		);
		expect(failures, `point each at the file that holds it now:\n${failures.join('\n')}`).toEqual(
			[]
		);
	});

	// Miss-analysis: no gate read comments, so `leaf-write.ts` outlived its file in three of them.
	it('reds on the pointer a deleted file leaves behind, and reads no string', () => {
		const relPath = 'src/lib/editor-actions/commit/text-batch.ts';
		const text = '// Each keystroke fires at its write (`leaf-write.ts`).\nconst s = `nope.ts`;\n';
		expect(referenceFailures(commentReferences(relPath, text), tree)).toEqual([
			`${relPath}: leaf-write.ts — no file in the tree ends with that path`
		]);
	});
});
