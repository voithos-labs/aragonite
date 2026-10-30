/**
 * A wrapper's entries import in plain Node with no DOM (G4.188): `scripts/pack/node-import.mjs` holds the
 * rule, and `verify-pack.mjs` runs it on every wrapper after the build.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nodeImportFailures } from '../../../../../scripts/pack/node-import.mjs';

const made: string[] = [];

function wrapperWith(entry: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'node-import-'));
	made.push(dir);
	mkdirSync(path.join(dir, 'dist'));
	const pkg = { name: 'fixture', type: 'module', exports: { '.': './dist/index.js' } };
	writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
	writeFileSync(path.join(dir, 'dist/index.js'), entry);
	return dir;
}

afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('wrapper entries import in Node', () => {
	it('passes an entry that touches the DOM only when called', () => {
		const entry = 'export const mount = (el) => el.append(document.createElement("div"));\n';

		expect(nodeImportFailures(wrapperWith(entry))).toEqual([]);
	});

	it.each([
		[
			'reads a constant declared below the export that uses it',
			'export const Component = { props: declarations() };\n' +
				'const OPTIONAL = { default: undefined };\n' +
				'function declarations() { return { flag: OPTIONAL }; }\n',
			"Cannot access 'OPTIONAL' before initialization"
		],
		['reads the DOM at import', 'export const root = document.body;\n', 'document is not defined']
	])('reports an entry that %s', (_, entry, error) => {
		const failures = nodeImportFailures(wrapperWith(entry));

		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain(`fixture's ./dist/index.js fails to import in Node`);
		expect(failures[0]).toContain(error);
	});
});
