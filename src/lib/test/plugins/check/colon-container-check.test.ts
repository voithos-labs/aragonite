// @vitest-environment node
// `check` over a container on colon lines passes every row: a body line of colons is widened past,
// and a key in its title row re-reads no data.
// Miss-analysis: no maker made a colon container, so no check held one to its closing line or title.
import { describe, expect, it } from 'vitest';
import { colonLines, container, definePlugin } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	return run.catch((error: unknown) => {
		if (isCheckFailure(error)) return error.report;
		throw error;
	});
}

const asides = definePlugin({
	name: 'asides',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			container<{ name: string }>({
				name: 'aside',
				label: 'Aside',
				lines: colonLines({ names: ['aside'] }),
				sample: ':::aside T\nbody\n:::\n',
				insert: { none: 'a fixture of the check suite' }
			})
		]
	})
});

describe('check over a colon container', () => {
	it('passes every row, its closing line and title row among them', async () => {
		const report = await reportOf(check(asides));
		expect(report.rows.filter((row) => row.status === 'failed')).toEqual([]);
		expect(
			report.rows
				.filter((row) => ['terminatorCollision', 'titleRow'].includes(row.check))
				.map((row) => `${row.subject} ${row.check} ${row.status}`)
		).toEqual(['asides/aside terminatorCollision passed', 'asides/aside titleRow passed']);
	});
});
