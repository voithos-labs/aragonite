/**
 * Every wrapper package releases with the core, and the library's version constant names it
 * (G4.181): `scripts/release/check-lockstep.mjs` holds the rule, and the publish script runs it first.
 */

import { describe, it, expect } from 'vitest';
import {
	libraryVersionDrift,
	lockstepDrift,
	readManifests
} from '../../../../../scripts/release/check-lockstep.mjs';

const ROOT = { version: '1.2.0' };
const wrapper = (version: string, peer?: string) => ({
	name: '@voithos-labs/aragonite-x',
	version,
	peerDependencies:
		peer === undefined ? {} : ({ '@voithos-labs/aragonite': peer } as Record<string, string>)
});

describe('lockstep versions', () => {
	it('holds on this tree, which has at least one wrapper', () => {
		const { root, wrappers, libraryVersion } = readManifests();

		expect(wrappers.length).toBeGreaterThan(0);
		expect(lockstepDrift(root, wrappers)).toEqual([]);
		expect(libraryVersionDrift(root, libraryVersion)).toEqual([]);
	});

	it('reports a version constant left behind by a release', () => {
		expect(libraryVersionDrift(ROOT, '1.1.0')).toHaveLength(1);
	});

	it.each([
		['its own version', wrapper('1.1.0', '1.2.0')],
		['its peer on the core', wrapper('1.2.0', '1.1.0')],
		['a range instead of the exact version', wrapper('1.2.0', '^1.2.0')],
		['no peer on the core at all', wrapper('1.2.0')]
	])('reports a wrapper that drifts by %s', (_, drifted) => {
		expect(lockstepDrift(ROOT, [drifted])).toHaveLength(1);
	});
});
