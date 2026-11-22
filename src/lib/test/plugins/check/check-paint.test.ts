// @vitest-environment node
// `check` asks a plugin's `paint` over every sample through the editor's own paint source, which
// leaves out a paint that can't land; and nests a highlighter's tokens as the code block draws them.
import { describe, expect, it } from 'vitest';
import { definePlugin, type Block, type CodeToken, type Paint } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';
import { spellcheckPlugin } from '#packages/spellcheck/src/index.js';
import { highlight } from '#packages/highlight/src/index.js';
import { highlightJs } from '#packages/highlight/src/renderer.js';

async function rowOf(run: Promise<CheckReport>, name: string) {
	let report: CheckReport;
	try {
		report = await run;
	} catch (error) {
		if (!isCheckFailure(error)) throw error;
		report = error.report;
	}
	return report.rows.find((row) => row.check === name);
}

const painting = (name: string, paint: (block: Block) => readonly Paint[]) =>
	definePlugin({ name, version: '1.0.0', editor: '*', contributes: () => ({ paint }) });

const mark = (from: number, to: number): Paint => ({ type: 'mark', from, to, class: 'x' });

describe('paintRanges', () => {
	it('passes a paint over each block’s own bytes', async () => {
		const whole = painting('whole', (block) => [mark(block.from, block.to - 1)]);
		expect(await rowOf(check(whole), 'paintRanges')).toMatchObject({
			of: 'plugin',
			status: 'passed'
		});
	});

	it('fails a paint range one byte past its block', async () => {
		const past = painting('past', (block) => [mark(block.from, block.to + 1)]);
		const row = await rowOf(check(past, { warningsFail: true }), 'paintRanges');
		expect(row?.status).toBe('failed');
		expect(row?.detail).toMatch(/isn't its block's text/);
	});

	it('fails a paint that throws, naming the block', async () => {
		const throws = painting('throws', () => {
			throw new Error('no paint for you');
		});
		expect((await rowOf(check(throws), 'paintRanges'))?.detail).toMatch(
			/paint threw over .*no paint/
		);
	});

	it('reads not-applicable for a paint that paints nothing on any sample', async () => {
		expect((await rowOf(check(painting('none', () => [])), 'paintRanges'))?.status).toBe(
			'not-applicable'
		);
	});

	it('places the spell check’s waves over every built-in sample, with a dictionary that answers at once', async () => {
		const everyWordWrong = { check: () => false, suggest: () => [] };
		const row = await rowOf(
			check(spellcheckPlugin, { options: { dictionary: everyWordWrong } }),
			'paintRanges'
		);
		expect(row).toMatchObject({ status: 'passed', detail: expect.stringMatching(/^\d+ paint/) });
	});
});

describe('codeTokens', () => {
	const highlighting = (name: string, tokens: (body: string) => readonly CodeToken[]) =>
		definePlugin({
			name,
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				code: { languages: () => [{ name: 'toy' }], highlight: (body: string) => tokens(body) }
			})
		});

	it('passes tokens that nest inside the body', async () => {
		const nested = highlighting('nested', () => [
			{ from: 0, to: 4, class: 'a' },
			{ from: 1, to: 2, class: 'b' }
		]);
		expect((await rowOf(check(nested), 'codeTokens'))?.status).toBe('passed');
	});

	it('fails tokens that cross, and one past the body', async () => {
		const crossing = highlighting('crossing', () => [
			{ from: 0, to: 3, class: 'a' },
			{ from: 2, to: 5, class: 'b' }
		]);
		expect((await rowOf(check(crossing), 'codeTokens'))?.detail).toMatch(/toy: 1 token/);
		const past = highlighting('beyond', (body) => [{ from: 0, to: body.length + 1, class: 'a' }]);
		expect((await rowOf(check(past), 'codeTokens'))?.status).toBe('failed');
	});

	it('passes the bundled highlighter over every language it lists', async () => {
		const row = await rowOf(
			check(highlight, { options: { renderer: highlightJs() } }),
			'codeTokens'
		);
		expect(row).toMatchObject({ status: 'passed' });
	});
});
