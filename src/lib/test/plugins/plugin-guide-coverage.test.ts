import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Drift guard: every export of the `aragonite/plugin` barrel must appear in the plugin
// guide's hand-written catalog, so a new export can't ship undocumented. Names match in
// backtick form, so incidental prose cannot stand in for a catalog entry. The section
// is keyed by its heading, which makes the heading load-bearing: rename it in both.
const CATALOG_HEADING = '\n## API reference';

function pluginExports(): string[] {
	const src = readFileSync(path.resolve('src/lib/plugin.ts'), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '');
	const names = new Set<string>();
	for (const [, body] of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
		for (const spec of body.split(',')) {
			// `default as BlockList` / `concatChildren as serializeChildren`: the
			// published name is the alias, never the local one.
			const name = spec
				.trim()
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

function catalogSection(): string {
	const guide = readFileSync(path.resolve('docs/guide/plugin-guide.md'), 'utf8');
	return guide.split(CATALOG_HEADING)[1]?.split('\n## ')[0] ?? '';
}

const exportNames = pluginExports();
const section = catalogSection();
const cataloged = (name: string, text = section) => text.includes(`\`${name}\``);

describe('plugin-guide § API reference catalogs the whole aragonite/plugin surface', () => {
	it('finds the catalog section, and a non-trivial export set with aliases resolved', () => {
		expect(section, `plugin-guide.md has no "${CATALOG_HEADING.trim()}" heading`).not.toBe('');
		expect(exportNames.length).toBeGreaterThan(40);
		expect(exportNames).toContain('serializeChildren');
		expect(exportNames).toContain('BlockList');
		expect(exportNames).not.toContain('concatChildren');
	});

	it('lists every export verbatim in the catalog tables', () => {
		expect(exportNames.filter((name) => !cataloged(name))).toEqual([]);
	});

	it('is not vacuous — a dropped catalog entry is detected', () => {
		const withoutOne = section.replaceAll('`createContainerBlock`', '`__dropped__`');
		expect(exportNames.filter((name) => !cataloged(name, withoutOne))).toEqual([
			'createContainerBlock'
		]);
	});
});
