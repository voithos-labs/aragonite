// G4.174: every entry point the core publishes has both builds, so a host whose bundler doesn't
// compile Svelte finds each one under `dist/prebuilt`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { publishedEntryPoints, SOURCE_CONDITION } from '../../../../../scripts/lib-alias.mjs';

const readPackage = () => JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));

describe('G4.174 every published entry point has a source build and a prebuilt one', () => {
	it('pairs each JavaScript export with the same path under dist/prebuilt', () => {
		// A self-import subpath (`./dev-checks`) is resolved by the host's own conditions, not an entry.
		const scripts = Object.values(readPackage().exports).filter(
			(t) => typeof t === 'object' && t !== null && !(SOURCE_CONDITION in t)
		);
		expect(publishedEntryPoints()).toHaveLength(scripts.length);
	});

	it('declares the prebuilt build side-effectful, so a host bundler keeps its registrations', () => {
		expect(readPackage().sideEffects).toContain('./dist/prebuilt/**/*.js');
	});
});
