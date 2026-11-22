/**
 * G4.374: a conformance cell reads through its `CheckContext`. A cell that parses or looks a kind
 * up on its own reads every installed plugin's syntax instead of the editor's under test, and a
 * round trip stays green under the wrong grammar, so the cell files may not name those reads.
 */

import { describe, expect, it } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';
import { SOURCE_DIR } from './source-paths';

const CELL_FILES = [
	'conformance-core.ts',
	'kind-conformance.ts',
	'container-conformance.ts',
	'inline-conformance.ts'
].map((name) => SOURCE_DIR.testing + name);

const OWN_READ =
	/\b(?:defaultGrammarView|defaultCheckContext|kitReading|getBlockKindDescriptor|tryGetBlockKindDescriptor|createHeadlessActions|assertParseConverged)\b|(?<![\w.])parse(?:Inline)?\(/g;

const ownReads = (code: string): string[] => code.match(OWN_READ) ?? [];

describe('G4.374 a conformance cell reads through its context', () => {
	const files = collectEditorSources().filter((file) => CELL_FILES.includes(file.relPath));

	it('finds every cell file', () => {
		expect(files.map((file) => file.relPath).sort()).toEqual([...CELL_FILES].sort());
	});

	it.each(CELL_FILES)('%s names no read of its own', (relPath) => {
		const file = files.find((candidate) => candidate.relPath === relPath)!;
		expect(ownReads(file.code)).toEqual([]);
	});

	it('catches each read a cell could make on its own, and passes the context', () => {
		const planted = [
			'const doc = parse(fixture);',
			'parseInline(raw, 0, raw.length)',
			'writeContainerRaw(node, defaultGrammarView)',
			'getBlockKindDescriptor(kind).rawWrite',
			'createHeadlessActions(doc)',
			'reading: kitReading()',
			'assertParseConverged(doc)',
			'runKindCells(defaultCheckContext, kind)'
		];
		for (const code of planted) expect(ownReads(code), code).toHaveLength(1);
		const clean = stripComments(
			'// parse(fixture) reads the default grammar\ncontext.parse(fixture); context.parseInline(raw, 0, 1); JSON.parse(text);',
			'script'
		);
		expect(ownReads(clean)).toEqual([]);
	});
});
