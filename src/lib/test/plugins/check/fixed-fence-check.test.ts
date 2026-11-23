// @vitest-environment node
// Miss-analysis: every fixed-fence row of the check suite read a fixture whole and none wrote over
// one, so a cut closer that let the block fall back to a paragraph, an `escape` that changed nothing
// and a type listing both kinds of fence each passed, though the editor got all three wrong.
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, fencedBlock, type Fence, type Plugin } from '#lib/plugin.js';
import { resetEditorEnv } from '#lib/testing.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

afterEach(() => resetEditorEnv());

const fixedPlugin = (fence: Fence | readonly Fence[], sample: string | string[]): Plugin =>
	definePlugin({
		name: 'fixeds',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				fencedBlock({
					name: 'fixed',
					label: 'Fixed',
					sample,
					insert: { none: 'a fixture of the check suite' },
					fence
				})
			]
		})
	});

async function reportOf(plugin: Plugin): Promise<CheckReport> {
	try {
		return await check(plugin);
	} catch (error) {
		if (isCheckFailure(error)) return error.report;
		throw error;
	}
}

const rowOf = (report: CheckReport, name: string) => report.rows.find((r) => r.check === name);

describe('check over a fixed fence', () => {
	it('passes rawWrite: a write that cuts the closing line gets it back', async () => {
		const report = await reportOf(fixedPlugin({ open: /^@@@$/, close: '@@@' }, '@@@\nx\ny\n@@@'));
		expect(rowOf(report, 'rawWrite')).toMatchObject({ status: 'passed' });
		expect(report.warnings).toEqual([]);
	});

	it('passes an escape that keeps a closer-spelled body line inside', async () => {
		const escaped = { open: /^@@@$/, close: '@@@', escape: (line: string) => ` ${line}` };
		const report = await reportOf(fixedPlugin(escaped, '@@@\nx\ny\n@@@'));
		expect(report.rows.filter((r) => r.status === 'failed')).toEqual([]);
		expect(report.warnings).toEqual([]);
	});

	it.each([
		['a closer it spells', '@@@'],
		['a closer its opener names', (open: RegExpExecArray) => `@@${open[1]}`]
	])('fails an escape that returns the line unchanged, on %s', async (_name, close) => {
		const fence = { open: /^@@(@)$/, close, escape: (line: string) => line };
		const plugin = fixedPlugin(fence, '@@@\nx\n@@@');
		await expect(check(plugin)).rejects.toThrow(
			/dev warning \[fence-escape\]: block 'fixeds\/fixed'.*"@@@"/
		);
		// A second run of the same value fails too: the warning is no once-only notice.
		const { warnings } = await reportOf(plugin);
		expect(new Set(warnings.map((w) => w.tag))).toEqual(new Set(['fence-escape']));
	});

	it('passes unfinishedReading on each sample of a type listing a fixed fence and a code fence', async () => {
		const fences = [{ open: /^\$\$$/, close: '$$' }, { info: 'math' }] as const;
		const report = await reportOf(fixedPlugin(fences, ['$$\nx^2\n$$', '```math\nx^2\n```']));
		expect(rowOf(report, 'unfinishedReading')).toMatchObject({
			status: 'passed',
			detail: expect.stringMatching(/closes or crosses/)
		});
	});
});
