/**
 * G4.211: every inline widget kind registered with `revealSource` is a row of the typed-opener
 * spec (`plugins/widget-reveal-caret.spec.ts`), so a new kind that shows its source gets the
 * caret rows the day it is registered. A kind with a content span names the spec that holds it.
 */
import { it, expect } from 'vitest';
import { collectFiles, LIBRARY_ROOTS, readSource } from '../../test/invariants/lint/scan-source';

const SPEC = 'src/lib/e2e/tests/plugins/widget-reveal-caret.spec.ts';

// The registering file, and the kind name its row carries, or the spec that covers a spanned kind.
const REGISTRATIONS: Record<string, { kind: string } | { coveredBy: string }> = {
	'src/lib/core/directive/kinds.ts': { kind: 'directiveText' },
	'packages/footnotes/src/footnote-reference.ts': { kind: 'footnote-ref' },
	'src/routes/test/plugins/tags/tag-plugin.ts': { kind: 'harness-tag' },
	'src/routes/test/plugins/wikilinks/link-plugin.ts': { kind: 'harness-wikilink' },
	'packages/latex/src/latex-kind.ts': {
		coveredBy: 'src/lib/e2e/tests/plugins/inline-delimiter-autopair.spec.ts'
	}
};

const REVEALS = /\brevealSource:\s*true\b/;
// Directory names, skipped wherever they sit: the suites and the published test kit.
const TEST_DIRS = ['test', 'e2e', 'testing'];

function registeringFiles(): string[] {
	return [...LIBRARY_ROOTS, 'src/routes/test/plugins']
		.flatMap((root) => collectFiles(root, { extensions: ['.ts', '.svelte'], skip: TEST_DIRS }))
		.map(readSource)
		.filter((file) => REVEALS.test(file.code))
		.map((file) => file.relPath)
		.sort();
}

const registering = registeringFiles();
const spec = readSource(SPEC).code;
const e2eSpecs = collectFiles('src/lib/e2e/tests', { extensions: ['.ts'] });

it('G4.211 every kind that shows its source has a row in the typed-opener spec', () => {
	expect(registering).toEqual(Object.keys(REGISTRATIONS).sort());
	for (const [file, entry] of Object.entries(REGISTRATIONS)) {
		if ('kind' in entry) expect(spec, file).toContain(`kind: '${entry.kind}'`);
		else expect(e2eSpecs, file).toContain(entry.coveredBy);
	}
});
