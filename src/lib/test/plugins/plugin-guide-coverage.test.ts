import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Drift guard: every export of the two published author barrels must appear in the plugin
// guide, so a new export can't ship undocumented. Names match in backtick form, so incidental
// prose cannot stand in for an entry. Each section is keyed by its heading, which makes the
// heading load-bearing: rename it in both.
const CATALOG_HEADING = '\n## API reference';
// `@voithos-labs/aragonite/testing` has no catalog table of its own — its section IS the catalog, and only
// its callables are enrolled; the kits' report types are read off the calls that return them.
const TESTING_HEADING = '\n## Verifying your plugin';

function barrelExports(relPath: string, valuesOnly = false): string[] {
	const src = readFileSync(path.resolve(relPath), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '');
	const names = new Set<string>();
	for (const [, typeKeyword, body] of src.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
		if (valuesOnly && typeKeyword) continue;
		for (const spec of body.split(',')) {
			const trimmed = spec.trim();
			if (valuesOnly && trimmed.startsWith('type ')) continue;
			// `default as BlockList` / `concatChildren as serializeChildren`: the
			// published name is the alias, never the local one.
			const name = trimmed
				.replace(/^type\s+/, '')
				.split(/\s+as\s+/)
				.pop()
				?.trim();
			if (name) names.add(name);
		}
	}
	for (const [, name] of src.matchAll(
		/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g
	)) {
		names.add(name);
	}
	return [...names];
}

function guideSection(heading: string): string {
	const guide = readFileSync(path.resolve('docs/guide/plugin-guide.md'), 'utf8');
	return guide.split(heading)[1]?.split('\n## ')[0] ?? '';
}

/**
 * A catalog cell names an export bare (`` `foo` ``); the prose-shaped testing section also
 * accepts a call (`` `foo(text)` ``). The catalog arm keeps the strict form, which is what
 * stops incidental prose from standing in for a table row.
 */
const undocumented = (names: string[], text: string, allowCallForm = false) =>
	names.filter((n) => !text.includes(`\`${n}\``) && !(allowCallForm && text.includes(`\`${n}(`)));

describe('plugin-guide § API reference catalogs the whole aragonite/plugin surface', () => {
	const exportNames = barrelExports('src/lib/plugin.ts');
	const section = guideSection(CATALOG_HEADING);

	it('finds the catalog section, and a non-trivial export set with aliases resolved', () => {
		expect(section, `plugin-guide.md has no "${CATALOG_HEADING.trim()}" heading`).not.toBe('');
		expect(exportNames.length).toBeGreaterThan(40);
		expect(exportNames).toContain('serializeChildren');
		expect(exportNames).toContain('BlockList');
		expect(exportNames).not.toContain('concatChildren');
	});

	it('lists every export verbatim in the catalog tables', () => {
		expect(undocumented(exportNames, section)).toEqual([]);
	});

	it('is not vacuous — a dropped catalog entry is detected', () => {
		const withoutOne = section.replaceAll('`createContainerBlock`', '`__dropped__`');
		expect(undocumented(exportNames, withoutOne)).toEqual(['createContainerBlock']);
	});
});

describe('plugin-guide § Verifying your plugin names every aragonite/testing callable', () => {
	const exportNames = barrelExports('src/lib/testing.ts', true);
	const section = guideSection(TESTING_HEADING);

	it('finds the section, and the callables without their type exports', () => {
		expect(section, `plugin-guide.md has no "${TESTING_HEADING.trim()}" heading`).not.toBe('');
		expect(exportNames).toContain('resetPluginPlatformForTests');
		expect(exportNames).toContain('runKindConformance');
		// A type export is not a callable and carries no documentation duty here.
		expect(exportNames).not.toContain('KindConformanceReport');
	});

	it('names every callable an author imports from the subpath', () => {
		expect(undocumented(exportNames, section, true)).toEqual([]);
	});

	it('is not vacuous — a dropped mention is detected', () => {
		const withoutOne = section.replaceAll('applyPasteTransforms', '__dropped__');
		expect(undocumented(exportNames, withoutOne, true)).toEqual(['applyPasteTransforms']);
	});
});
