import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readSource } from '../invariants/lint/scan-source';

// Drift guard: every export of the three published author barrels must appear in the docs pack,
// so a new export can't ship undocumented, and every name the consumer guide's export table lists
// must be a real main-barrel export. Names match in backtick form, so incidental prose can't stand
// in for an entry. Each section is found by its heading, so rename a heading in both places.
const CATALOG_DOC = 'docs/guide/plugin-api.md';
const CATALOG_HEADING = '\n## API reference';
// `@voithos-labs/aragonite/testing` has no catalog table: its section is the catalog, only its
// callables are enrolled, and the kits' report types are read off the calls that return them.
const TESTING_DOC = 'docs/guide/plugin-testing.md';
const TESTING_HEADING = '\n## Verifying your plugin';

function barrelExports(relPath: string, valuesOnly = false): string[] {
	const src = readSource(relPath).code;
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

function guideSection(doc: string, heading: string): string {
	const text = readFileSync(path.resolve(doc), 'utf8');
	return text.split(heading)[1]?.split('\n## ')[0] ?? '';
}

/** A catalog cell names an export bare (`` `foo` ``), which keeps incidental prose from standing
 *  in for a row; the prose-shaped testing section also accepts a call (`` `foo(text)` ``). */
const undocumented = (names: string[], text: string, allowCallForm = false) =>
	names.filter((n) => !text.includes(`\`${n}\``) && !(allowCallForm && text.includes(`\`${n}(`)));

describe('plugin-api § API reference catalogs the whole aragonite/plugin surface', () => {
	const exportNames = barrelExports('src/lib/plugin.ts');
	const section = guideSection(CATALOG_DOC, CATALOG_HEADING);

	it('finds the catalog section, and a non-trivial export set with aliases resolved', () => {
		expect(section, `${CATALOG_DOC} has no "${CATALOG_HEADING.trim()}" heading`).not.toBe('');
		expect(exportNames.length).toBeGreaterThan(40);
		expect(exportNames).toContain('serializeChildren');
		expect(exportNames).not.toContain('concatChildren');
	});

	it('lists every export verbatim in the catalog tables', () => {
		expect(undocumented(exportNames, section)).toEqual([]);
	});

	it('is not vacuous: a dropped catalog entry is detected', () => {
		const withoutOne = section.replaceAll('`registerChromeLeaf`', '`__dropped__`');
		expect(undocumented(exportNames, withoutOne)).toEqual(['registerChromeLeaf']);
	});
});

describe('plugin-api § API reference catalogs the whole aragonite/svelte surface', () => {
	const exportNames = barrelExports('src/lib/svelte.ts');
	const section = guideSection(CATALOG_DOC, CATALOG_HEADING);

	it('finds the Svelte exports, the default-export aliases resolved', () => {
		expect(exportNames).toContain('Editor');
		expect(exportNames).toContain('BlockList');
		expect(exportNames).toContain('svelteBlockView');
	});

	it('lists every export verbatim in the catalog', () => {
		expect(undocumented(exportNames, section)).toEqual([]);
	});

	it('is not vacuous: a dropped catalog entry is detected', () => {
		const withoutOne = section.replaceAll('`createContainerBlock`', '`__dropped__`');
		expect(undocumented(exportNames, withoutOne)).toEqual(['createContainerBlock']);
	});
});

// The wrappers' component is the consumer guide's; everything else they export draws plugin blocks.
const WRAPPER_COMPONENT = ['Aragonite', 'AragoniteProps', 'AragoniteInstance', 'EditorHandle'];

describe.each(['react', 'vue'])(
	'plugin-api § API reference catalogs the %s wrapper’s plugin exports',
	(framework) => {
		const exportNames = barrelExports(`packages/${framework}/src/index.ts`).filter(
			(name) => !WRAPPER_COMPONENT.includes(name)
		);
		const section = guideSection(CATALOG_DOC, CATALOG_HEADING);

		it('finds the plugin exports', () => {
			expect(exportNames).toContain('useDrawn');
			expect(exportNames).toContain(`${framework}Block`);
		});

		it('lists every one verbatim in the catalog', () => {
			expect(undocumented(exportNames, section)).toEqual([]);
		});

		it('is not vacuous: a dropped catalog entry is detected', () => {
			const withoutOne = section.replaceAll('`useDrawn`', '`__dropped__`');
			expect(undocumented(exportNames, withoutOne)).toEqual(['useDrawn']);
		});
	}
);

describe('plugin-testing § Verifying your plugin names every aragonite/testing callable', () => {
	const exportNames = barrelExports('src/lib/testing.ts', true);
	const section = guideSection(TESTING_DOC, TESTING_HEADING);

	it('finds the section, and the callables without their type exports', () => {
		expect(section, `${TESTING_DOC} has no "${TESTING_HEADING.trim()}" heading`).not.toBe('');
		expect(exportNames).toContain('resetPluginPlatformForTests');
		expect(exportNames).toContain('runKindConformance');
		// A type export is not a callable and carries no documentation duty here.
		expect(exportNames).not.toContain('KindConformanceReport');
	});

	it('names every callable an author imports from the subpath', () => {
		expect(undocumented(exportNames, section, true)).toEqual([]);
	});

	it('is not vacuous: a dropped mention is detected', () => {
		const withoutOne = section.replaceAll('applyPasteTransforms', '__dropped__');
		expect(undocumented(exportNames, withoutOne, true)).toEqual(['applyPasteTransforms']);
	});
});

describe('consumer-guide § The public surface names only real main-barrel exports', () => {
	const exportNames = barrelExports('src/lib/index.ts');
	const section = guideSection('docs/guide/consumer-guide.md', '\n## The public surface');

	/** The backticked names in the table's Exports column, the second cell of each body row. */
	const listedNames = (text: string) =>
		text
			.split('\n')
			.filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
			.slice(1)
			.flatMap((line) => [...(line.split('|')[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]));

	it('every listed name is exported, and a renamed one is caught', () => {
		expect(listedNames(section).length).toBeGreaterThan(40);
		expect(listedNames(section).filter((n) => !exportNames.includes(n))).toEqual([]);
		const renamed = section.replace('`normalizeSelection`', '`normaliseSelection`');
		expect(listedNames(renamed).filter((n) => !exportNames.includes(n))).toEqual([
			'normaliseSelection'
		]);
	});
});
