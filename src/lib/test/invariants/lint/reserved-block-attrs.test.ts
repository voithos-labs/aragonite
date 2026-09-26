/**
 * G4.70: every `data-` attribute the editor's own source sets or reads is one a block decoration
 * may not set, or is listed below with the reason a decoration setting it is harmless. A new
 * attribute fails here until it joins `RESERVED_BLOCK_ATTRS` or this list.
 * Miss-analysis: the reserved set was pinned against itself, so an attribute added later (the
 * kind cue's label) never had to be reserved and a decoration could paint it.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC } from './scan-source';
import { RESERVED_BLOCK_ATTRS } from '$lib/decorations/reserved-attrs';

const NOT_RESERVED: Record<string, string> = {
	'data-testid': 'a test hook no editor code reads, which a host test may set on its own blocks'
};

const LITERAL = /(?<![\w-])data-[a-z][a-z0-9-]*[a-z0-9](?![\w-])/g;
const DATASET = /\bdataset\.([a-zA-Z]+)|\bdataset\[['"]([a-zA-Z-]+)['"]\]/g;

const kebab = (camel: string) => camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function attributesNamed(code: string): string[] {
	const names = [...code.matchAll(LITERAL)].map((m) => m[0]);
	for (const m of code.matchAll(DATASET)) names.push(`data-${kebab(m[1] ?? m[2])}`);
	return names;
}

describe('G4.70 every data attribute the editor names is reserved from block decorations', () => {
	const sources = collectEditorSources(EDITOR_SRC, { includeStyles: true });
	const named = new Map<string, string>();
	for (const file of sources) {
		for (const name of attributesNamed(file.code)) {
			if (!named.has(name)) named.set(name, file.relPath);
		}
	}

	it('finds the attributes it guards, so an empty scan cannot pass', () => {
		expect(named.get('data-block-path')).toBeDefined();
		expect(named.get('data-source-start')).toBeDefined();
	});

	it('leaves none unreserved without a reason', () => {
		const unlisted = [...named]
			.filter(([name]) => !RESERVED_BLOCK_ATTRS.has(name) && !(name in NOT_RESERVED))
			.map(([name, file]) => `${name} (${file})`);
		expect(unlisted).toEqual([]);
	});

	it('lists no exception the source no longer names', () => {
		expect(Object.keys(NOT_RESERVED).filter((name) => !named.has(name))).toEqual([]);
	});
});
