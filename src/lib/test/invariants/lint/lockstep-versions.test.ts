/**
 * Every workspace package, wrapper or plugin, releases with the core, and the library's version
 * constant names it (G4.181), as does every version the plugin template names (G4.278):
 * `scripts/release/check-lockstep.mjs` holds the rule, and the publish script runs it first.
 */

import { describe, it, expect } from 'vitest';
import {
	libraryVersionDrift,
	lockstepDrift,
	readManifests,
	readTemplate,
	templateDrift
} from '../../../../../scripts/release/check-lockstep.mjs';

const ROOT = { version: '1.2.0' };
const wrapper = (version: string, peer?: string) => ({
	name: '@voithos-labs/aragonite-x',
	version,
	peerDependencies:
		peer === undefined ? {} : ({ '@voithos-labs/aragonite': peer } as Record<string, string>)
});

describe('lockstep versions', () => {
	it('holds on this tree, wrappers and plugin packages both', () => {
		const { root, packages, libraryVersion } = readManifests();
		const names = packages.map((pkg) => pkg.name);

		expect(names).toContain('@voithos-labs/aragonite-react');
		expect(names).toContain('@voithos-labs/aragonite-latex');
		expect(lockstepDrift(root, packages)).toEqual([]);
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
	])('reports a package that drifts by %s', (_, drifted) => {
		expect(lockstepDrift(ROOT, [drifted])).toHaveLength(1);
	});
});

describe('G4.278 the plugin template names the editor it ships with', () => {
	const CORE = '@voithos-labs/aragonite';
	const inStep = { devDependencies: { [CORE]: '1.2.0' }, peerDependencies: { [CORE]: '^1.2.0' } };
	const workflow = (text: string): [string, string, RegExp] => [
		'ci.yml',
		text,
		/plugin-check\.yml@v(\d[\w.-]*)/g
	];
	const tagged = (tag: string) => workflow(`uses: o/aragonite/x/plugin-check.yml@v${tag}`);

	it('holds on this tree', () => {
		const { root } = readManifests();
		const { manifest, sites } = readTemplate();
		expect(sites).toHaveLength(3);
		expect(templateDrift(root, manifest, sites)).toEqual([]);
	});

	it.each([
		[
			'an exact peer, which no later patch satisfies',
			{ ...inStep, peerDependencies: { [CORE]: '1.2.0' } },
			tagged('1.2.0')
		],
		[
			'a devDependency left on the last release',
			{ ...inStep, devDependencies: { [CORE]: '1.1.0' } },
			tagged('1.2.0')
		],
		['a workflow tag left on the last release', inStep, tagged('1.1.0')],
		['a file that stopped naming any version', inStep, workflow('uses: nothing')]
	])('reports %s', (_, manifest, site) => {
		expect(templateDrift(ROOT, manifest, [site])).toHaveLength(1);
	});
});
