/**
 * The range-edit law harness reaches the editor only through its event routes (G4.295): a file
 * under `src/lib/test/range-laws/` imports the shared test harness and generators, the public
 * entry point, the e2e case table, and the few reads the law checks need, each named below with
 * why. A tree operation called directly would test a core the routes might never reach.
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources, importSpecifiers, resolveSpecifier } from './scan-source';

const HARNESS = 'src/lib/test/range-laws/';

/** Repo paths (a prefix for a directory) a harness file may import, and why. */
const ALLOWED: Record<string, string> = {
	'src/lib/test/range-laws/': 'the harness itself',
	'src/lib/test/harness/':
		'the shared mount, event and clipboard stand-ins every unit suite drives',
	'src/lib/test/invariants/arbitraries/': 'the property suites’ document generators and seed',
	'src/lib/test/behavior/corpus.ts': 'the behavior corpus and its syntax plugins',
	'src/lib/test/exhaustive/edit-driver.ts': 'the reload check every edit suite judges a tree by',
	'src/lib/test/support/warn-gate.ts': 'taking the dev checks a run fired, which law 8 counts',
	'src/lib/e2e/range-law-cases.ts': 'the case table the browser spec drives too',
	'src/lib/index.ts': 'the public entry point',
	'src/lib/schema/opened-reading.ts':
		'how the editor opens a document, so a law check’s positions name the blocks the editor has',
	'src/lib/selection/range-coverage.ts':
		'the coverage rules the laws take as input (table rows, a closed details, a block held whole)',
	'src/lib/core/inline/link-source-bytes.ts': 'the text a block shows, which law 11 reads',
	'src/lib/components/menu/default-context-actions.ts':
		'the menu rows the editor registers at startup, which the menu routes press'
};
const PACKAGES = new Set(['vitest', 'fast-check', 'node:fs', 'node:path']);

function allowed(fromPath: string, specifier: string): boolean {
	if (PACKAGES.has(specifier)) return true;
	const target = resolveSpecifier(fromPath, specifier);
	return (
		target !== null &&
		Object.keys(ALLOWED).some((entry) =>
			entry.endsWith('/') ? target.startsWith(entry) : target === entry
		)
	);
}

describe('the range-edit law harness imports only its allowed modules (G4.295)', () => {
	const files = collectEditorSources(HARNESS, { includeTests: true });

	it('finds the harness files', () => {
		expect(files.length).toBeGreaterThan(5);
	});

	it('imports nothing else at run time', () => {
		const offending = files.flatMap((file) =>
			importSpecifiers(file.text)
				.filter((s) => !s.typeOnly && !allowed(file.relPath, s.specifier))
				.map((s) => `${file.relPath}: ${s.specifier}`)
		);
		expect(
			offending,
			'drive the editor through an event route, or name the read and its reason in ALLOWED'
		).toEqual([]);
	});

	it('flags a tree operation and spares an allowed read', () => {
		const from = `${HARNESS}laws.ts`;
		expect(allowed(from, '#lib/tree-operations/leaf-range.js')).toBe(false);
		expect(allowed(from, '#lib/selection/range-coverage.js')).toBe(true);
	});
});
