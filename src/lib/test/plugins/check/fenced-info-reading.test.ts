// @vitest-environment node
// Miss-analysis: every fenced row of the check suite drove a fixed closer, or an info fence left
// open on purpose, so a closed info fence, the commonest fenced block, was never seen whole: it
// failed `unfinishedReading`, which no excuse covers, and was told to declare a reading no maker takes.
import { expect, it } from 'vitest';
import { definePlugin, fencedBlock } from '#lib/plugin.js';
import { check } from '#lib/testing/check.js';

it('passes a fenced block on an info string, its reading the code fence’s own', async () => {
	const chart = fencedBlock({
		name: 'chart',
		label: 'Chart',
		sample: ['```chart\nx\n```', '~~~~chart\n```\n~~~~'],
		insert: { none: 'a fixture of the check suite' },
		fence: { info: 'chart' }
	});
	const report = await check(
		definePlugin({
			name: 'charts',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [chart] })
		})
	);
	const row = report.rows.find((r) => r.check === 'unfinishedReading');
	expect(row).toMatchObject({
		status: 'passed',
		detail: expect.stringMatching(/closes or crosses/)
	});
});
