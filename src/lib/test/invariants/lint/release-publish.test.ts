/**
 * The release publishes the core first and then every workspace package, and a run stopped partway
 * publishes only what npm doesn't hold yet when run again (`scripts/release/publish.mjs`).
 */

import { describe, it, expect } from 'vitest';
import { workspacePackages } from '../../../../../scripts/lib-alias.mjs';
import { publishPlan, releasePackages } from '../../../../../scripts/release/publish.mjs';

describe('release publish', () => {
	it('publishes the core first, then every workspace package', () => {
		const packages = releasePackages();

		expect(packages[0]).toMatchObject({ name: '@voithos-labs/aragonite', workspace: null });
		expect(packages.slice(1).map((pkg) => pkg.workspace)).toEqual(
			workspacePackages().map(({ dir }) => dir)
		);
	});

	it('picks up after a run that stopped partway, in the same order', () => {
		const packages = releasePackages();
		const stoppedAt = 3;
		const published = new Set(packages.slice(0, stoppedAt).map((pkg) => pkg.name));

		const { todo, done } = publishPlan(packages, (pkg) => published.has(pkg.name));

		expect(done).toEqual(packages.slice(0, stoppedAt));
		expect(todo).toEqual(packages.slice(stoppedAt));
	});
});
