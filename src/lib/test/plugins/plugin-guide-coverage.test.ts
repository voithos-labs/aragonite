import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Drift guard: plugin-guide.md § 2 is the hand-written catalog of the
// `aragonite/plugin` surface. Every value and type the barrel exports must appear
// there, so a new export can't ship undocumented. Names are matched in the guide's
// backtick form (its table convention), so an incidental prose substring can't
// stand in for a real catalog entry.

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

function guideSection2(): string {
	const guide = readFileSync(path.resolve('docs/editor/plugin-guide.md'), 'utf8');
	return guide.split('\n## 2. ')[1]?.split('\n## ')[0] ?? '';
}

const exportNames = pluginExports();
const section = guideSection2();
const cataloged = (name: string, text = section) => text.includes(`\`${name}\``);

describe('plugin-guide § 2 catalogs the whole aragonite/plugin surface', () => {
	it('parses a non-trivial export set, resolving re-export aliases to the published name', () => {
		expect(exportNames.length).toBeGreaterThan(40);
		expect(exportNames).toContain('serializeChildren');
		expect(exportNames).toContain('BlockList');
		expect(exportNames).not.toContain('concatChildren');
	});

	it('lists every export verbatim in the § 2 tables', () => {
		expect(exportNames.filter((name) => !cataloged(name))).toEqual([]);
	});

	it('is not vacuous — a dropped catalog entry is detected', () => {
		const withoutOne = section.replaceAll('`createContainerBlock`', '`__dropped__`');
		expect(exportNames.filter((name) => !cataloged(name, withoutOne))).toEqual([
			'createContainerBlock'
		]);
	});
});
