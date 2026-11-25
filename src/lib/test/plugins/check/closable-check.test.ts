// @vitest-environment node
// `check` holds a closable container's `set` to its `closed`: over each sample, closing writes data
// that reads closed, opening data that reads open, and setting the same value twice changes nothing.
// Miss-analysis: no check read `closable` at all, so a `set` that inverted the flag gave a toggle
// that wrote and did nothing, with every row green.
import { describe, expect, it } from 'vitest';
import { container, definePlugin } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';
import { FOLD_LINES, FOLD_SAMPLE, type FoldData } from '#lib/test/support/fold-fixture.js';

type Closable = { closed(data: FoldData): boolean; set(data: FoldData, closed: boolean): FoldData };

/** The fold fixture under a plugin of its own, with `closable` swapped. */
const foldWith = (name: string, closable: Closable | undefined) =>
	definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				container<FoldData>({
					name: 'fold',
					label: 'Fold',
					lines: FOLD_LINES,
					...(closable && { closable }),
					sample: [FOLD_SAMPLE, FOLD_SAMPLE.replace('[fold]', '[fold open]')],
					insert: { none: 'a fixture of the check suite' }
				})
			]
		})
	});

async function closableRow(plugin: ReturnType<typeof foldWith>) {
	let report: CheckReport;
	try {
		report = await check(plugin);
	} catch (error) {
		if (!isCheckFailure(error)) throw error;
		report = error.report;
	}
	return report.rows.find((row) => row.check === 'closable');
}

const closed = (data: FoldData) => !data.open;

describe('closable', () => {
	it('passes a set its closed reads back', async () => {
		const row = await closableRow(
			foldWith('fold-kept', { closed, set: (data, shut) => ({ ...data, open: !shut }) })
		);
		expect(row).toMatchObject({ status: 'passed' });
	});

	it('fails a set that writes the flag the other way round', async () => {
		const row = await closableRow(
			foldWith('fold-inverted', { closed, set: (data, shut) => ({ ...data, open: shut }) })
		);
		expect(row?.status).toBe('failed');
		expect(row?.detail).toMatch(/closing .* reads open/);
	});

	it('fails a set whose second call changes the data again', async () => {
		const counting = (data: FoldData, shut: boolean) =>
			({ ...data, open: !shut, n: ((data as { n?: number }).n ?? 0) + 1 }) as FoldData;
		const row = await closableRow(foldWith('fold-counting', { closed, set: counting }));
		expect(row?.status).toBe('failed');
		expect(row?.detail).toMatch(/twice/);
	});

	it('does not apply to a container that does not fold', async () => {
		const row = await closableRow(foldWith('fold-fixed', undefined));
		expect(row?.status).toBe('not-applicable');
	});
});
