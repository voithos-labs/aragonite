// @vitest-environment node
// `check` over a container on fenced lines: every row passes for one that escapes a body line
// spelling its closing line, a body line that closes it early fails `terminatorCollision`, and a
// title row is typed in. A container marked line by line has neither row to run.
// Miss-analysis: the two rows ran only in the kit's own runner, over a profile a package wrote, so
// no check held a container a maker made to its closing line or its title row.
import { describe, expect, it } from 'vitest';
import { container, definePlugin, fencedLines } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import { folds, FOLD_SAMPLE } from '#lib/test/support/fold-fixture.js';

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	return run.catch((error: unknown) => {
		if (isCheckFailure(error)) return error.report;
		throw error;
	});
}

const rowsOf = (report: CheckReport, ...checks: string[]) =>
	report.rows
		.filter((row) => checks.includes(row.check))
		.map((row) => `${row.subject} ${row.check} ${row.status}`);

/** The fixture's lines with `escape` swapped, under a plugin of its own. */
function escaping(escape: ((line: string) => string) | undefined) {
	const lines = fencedLines<{ open: boolean }>({
		open: /^\[fold( open)?(?=\])/,
		data: (match) => ({ open: match[1] !== undefined }),
		write: (data) => (data.open ? '[fold open]' : '[fold]'),
		title: { match: /^title: (?<text>.*)$/, write: (title) => `title: ${title}` },
		close: { match: /^\[\/fold(?=\])/, write: () => '[/fold]' },
		escape: escape as (line: string) => string
	});
	return definePlugin({
		name: 'folds',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				container({
					name: 'fold',
					label: 'Fold',
					lines,
					sample: FOLD_SAMPLE,
					insert: { none: 'a fixture of the check suite' }
				})
			]
		})
	});
}

describe('check over a fenced container', () => {
	it('passes every row, its closing line and title row among them', async () => {
		const report = await reportOf(check(folds));
		expect(report.rows.filter((row) => row.status === 'failed')).toEqual([]);
		expect(rowsOf(report, 'terminatorCollision', 'titleRow')).toEqual([
			'folds/fold terminatorCollision passed',
			'folds/fold titleRow passed'
		]);
	});

	it.each([
		['no escape', undefined],
		['an escape that changes nothing', (line: string) => line]
	])('fails terminatorCollision with %s', async (_name, escape) => {
		const report = await reportOf(check(escaping(escape)));
		takeDevWarnsOf('fence-escape');
		expect(rowsOf(report, 'terminatorCollision')).toEqual([
			'folds/fold terminatorCollision failed'
		]);
	});
});

describe('check over a container marked line by line', () => {
	it('runs neither row', async () => {
		const marked = definePlugin({
			name: 'quotes',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					container({
						name: 'quote',
						label: 'Quote',
						lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true },
						sample: '%> one',
						insert: { none: 'a fixture of the check suite' }
					})
				]
			})
		});
		const report = await reportOf(check(marked));
		expect(rowsOf(report, 'terminatorCollision', 'titleRow')).toEqual([
			'quotes/quote terminatorCollision not-applicable',
			'quotes/quote titleRow not-applicable'
		]);
	});
});
