// @vitest-environment node
// Miss-analysis: every row of the check suite handed `check` a plugin value and excused a check that
// passed, so a factory handed uncalled failed `install` on a property of undefined, and an excuse no
// check takes replaced the failure it sat on.
import { describe, expect, it } from 'vitest';
import { container, definePlugin } from '#lib/plugin.js';
import { check, isCheckFailure, type Excuses } from '#lib/testing/check.js';
import { suiteProblem } from '../../../../../bin/aragonite-plugin-check.mjs';

const factory = () =>
	definePlugin({ name: 'made', version: '1.0.0', editor: '*', contributes: () => ({}) });

describe('what check refuses to run', () => {
	it('refuses a factory handed uncalled, saying what to hand it', async () => {
		await expect(check(factory as never)).rejects.toThrow(
			/no plugin value: hand it what definePlugin returned/
		);
		expect(await check(factory())).toMatchObject({ plugin: 'made' });
	});

	it('has the bin call a suite holding a factory no suite, as it does any other function', () => {
		expect(suiteProblem({ plugin: factory })).toMatch(/holds no plugin value/);
		expect(suiteProblem({ plugin: function named() {} })).toMatch(/holds no plugin value/);
		expect(suiteProblem({ plugin: factory() })).toBeNull();
	});
});

describe('an excuse no check takes', () => {
	it('keeps what the check found', async () => {
		const flag = container({
			name: 'flag',
			label: 'Flag',
			sample: '%> [!NOTE]\n%> x',
			insert: { none: 'a fixture of the check suite' },
			lines: {
				shape: 'marked',
				first: '%> ',
				rest: '%> ',
				reads: /^%> ?/,
				lazy: true,
				head: {
					match: /^\[!(\w+)\]$/,
					data: (match: RegExpExecArray) => ({ type: match[1] }),
					write: (data: { type: string }) => `[${data.type}]`
				}
			}
		});
		const plugin = definePlugin({
			name: 'flags',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [flag] })
		});
		const excuse = {
			blocks: { flag: { containerDeclared: 'a sentence long enough to count as one' } }
		} as unknown as Excuses;
		const failure = await check(plugin, { excuse }).catch((error: unknown) => error);
		if (!isCheckFailure(failure)) throw failure;
		expect(failure.report.rows.find((row) => row.check === 'containerDeclared')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(
				/^excused, but an excuse never covers this check \(it found: .*head\.write gives "\[NOTE\]"/
			)
		});
	});
});
