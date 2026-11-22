// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { runSuite } from '../../../../bin/aragonite-plugin-check.mjs';

// Each bundled plugin passes its own published suite through the bin's reading of either shape,
// with no DOM, as a listing runs it: the first-party packages clear an outside author's bar.
const suiteOf = async (dir: string) =>
	((await import(`../../../../packages/${dir}/src/conformance.ts`)) as { default: object }).default;

describe('every bundled plugin passes its own published conformance suite', () => {
	it.each(bundledPluginDirs())('%s', async (dir) => {
		const outcome = await runSuite(await suiteOf(dir));
		expect(outcome.message).toBeNull();
		expect(outcome.result).toBe('pass');
	});

	it('enrolls every bundled plugin, the plugin values among them through check', async () => {
		const dirs = bundledPluginDirs();
		expect(dirs).toHaveLength(12);
		const values = [];
		for (const dir of dirs) if ('plugin' in (await suiteOf(dir))) values.push(dir);
		expect(values).toEqual(['highlight', 'parrot', 'slash-commands', 'spellcheck']);
	});
});
