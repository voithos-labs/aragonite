// @vitest-environment node
// Miss-analysis: `containerDeclared` wrote through a shape only to grow a one-child sample, and only
// counted the children that read back. A sample of two children never met the writer, and a line
// that read back as other text passed.
import { describe, expect, it } from 'vitest';
import { container, definePlugin } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	return run.catch((error: unknown) => {
		if (isCheckFailure(error)) return error.report;
		throw error;
	});
}

// No test can break the editor's writer, so a `reads` taking the first word the check writes stands
// in: the line reads back short. The install check asks about a marker before an `x` only.
function eating(name: string, sample: string) {
	const type = container({
		name: 'box',
		label: 'Box',
		sample,
		insert: { none: 'a fixture of the check suite' },
		lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?(?:probe)?/, lazy: true }
	});
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [type] })
	});
}

describe('containerDeclared writes a child through the shape and reads it back', () => {
	it.each([
		['one child', 'eats-one', '%> one'],
		['two children', 'eats-two', '%> one\n%>\n%> two']
	])(
		'fails a shape that reads its own line back as other text, over %s',
		async (_n, name, sample) => {
			const report = await reportOf(check(eating(name, sample)));
			expect(report.rows.find((row) => row.check === 'sample')?.status).toBe('passed');
			expect(report.rows.find((row) => row.check === 'containerDeclared')).toMatchObject({
				status: 'failed',
				detail: expect.stringMatching(
					/write a child added to the sample as .* doesn't read back as that child/
				)
			});
		}
	);
});
