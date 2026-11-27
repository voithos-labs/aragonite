/**
 * G4.413: every parse in the published testing folder names the grammar it reads with. A bare
 * `parse(text)` reads every page-wide registration, which a plugin value never joins, so a kit or
 * a headless harness would read the value's syntax as another editor's.
 */

import { describe, expect, it } from 'vitest';
import { callsTo, collectEditorSources, languageOf, stripComments } from './scan-source';
import { SOURCE_DIR } from './source-paths';

/** The argument text of each `parse(...)` call in comment-stripped `code` that names no grammar. */
const unnamedReads = (code: string): string[] =>
	callsTo(code, 'parse').filter((args) => !/\bgrammar\b/.test(args));

describe('G4.413 the testing folder names the grammar of every parse', () => {
	const files = collectEditorSources()
		.filter((file) => file.relPath.startsWith(SOURCE_DIR.testing))
		.map((file) => ({ ...file, code: stripComments(file.code, languageOf(file.relPath)) }));

	it('finds the testing files and their reads', () => {
		expect(files.length).toBeGreaterThan(10);
		expect(files.flatMap((file) => callsTo(file.code, 'parse')).length).toBeGreaterThan(0);
	});

	it('no parse there reads page-wide by leaving its grammar out', () => {
		const offenders = files.flatMap((file) =>
			unnamedReads(file.code).map((args) => `${file.relPath}: parse(${args})`)
		);
		expect(offenders).toEqual([]);
	});

	it('catches a bare read and passes a named one', () => {
		expect(unnamedReads('const doc = parse(source);')).toHaveLength(1);
		expect(unnamedReads('parse(serialize(doc))')).toHaveLength(1);
		expect(unnamedReads('parse(source, { grammar })')).toEqual([]);
		expect(unnamedReads('context.parse(text); JSON.parse(text);')).toEqual([]);
		expect(unnamedReads('interface C { parse(text: string): Document; }')).toEqual([]);
	});
});
