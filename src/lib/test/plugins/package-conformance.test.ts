// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { runPluginConformance, type PluginConformanceSuite } from '#lib/testing.js';
import { bundledPluginDirs } from '../invariants/lint/scan-source';

// Each bundled plugin publishes the suite a listing runs over it, and passes it here first, so the
// first-party packages clear the same bar an outside author's must.
describe('every bundled plugin passes its own published conformance suite', () => {
	it.each(bundledPluginDirs())('%s', async (dir) => {
		const suite = (
			(await import(`../../../../packages/${dir}/src/conformance.ts`)) as {
				default: PluginConformanceSuite;
			}
		).default;
		const report = await runPluginConformance(suite);
		expect(report.plugins.length).toBeGreaterThan(0);
	});

	it('enrolls every bundled plugin', () => {
		expect(bundledPluginDirs()).toHaveLength(10);
	});
});
