/**
 * G4.374: a conformance cell reads through its `CheckContext`. A cell that parses or looks a kind
 * up on its own reads every installed plugin's syntax instead of the editor's under test, and a
 * round trip stays green under the wrong grammar, so no file of the published kits may name those
 * reads but the few that build them.
 */

import { describe, expect, it } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';
import { SOURCE_DIR } from './source-paths';

/** The files that may name a default read, each with why. */
const ALLOWED: Record<string, string> = {
	'check-context.ts': 'builds the context every cell reads through',
	'plugin-conformance.ts': 'the legacy door, which checks the page-wide registry by design',
	'headless-actions.ts': 'defines the headless actions; a cell gets them from the context',
	'kit-reading.ts': 'defines the default reading the context replaces',
	'parse-convergence.ts': 'defines the default convergence check the context replaces'
};

const OWN_READ =
	/\b(?:defaultGrammarView|defaultCheckContext|kitReading|getBlockKindDescriptor|tryGetBlockKindDescriptor|createHeadlessActions|assertParseConverged)\b|(?<![\w.])parse(?:Inline)?\(/g;

const ownReads = (code: string): string[] => code.match(OWN_READ) ?? [];

describe('G4.374 a conformance cell reads through its context', () => {
	const files = collectEditorSources().filter((file) =>
		file.relPath.startsWith(SOURCE_DIR.testing)
	);
	const nameOf = (relPath: string) => relPath.slice(SOURCE_DIR.testing.length);

	it('finds the kit files, and every allowed file is still one', () => {
		expect(files.length).toBeGreaterThan(10);
		const names = files.map((file) => nameOf(file.relPath));
		expect(Object.keys(ALLOWED).filter((name) => !names.includes(name))).toEqual([]);
	});

	it('no other file under the kits names a read of its own', () => {
		const offenders = files
			.filter((file) => !(nameOf(file.relPath) in ALLOWED))
			.flatMap((file) => ownReads(file.code).map((read) => `${file.relPath}: ${read}`));
		expect(offenders).toEqual([]);
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
