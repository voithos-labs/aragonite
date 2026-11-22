// @vitest-environment node
// `check` pastes each type a plugin rewrites, at the top and inside a container, with a block below:
// an answer lands as blocks of its own and a paste of it isn't rewritten again. `rewritePaste` runs
// the same production function over a plugin list.
import { describe, expect, it } from 'vitest';
import { builtin, definePlugin, rewrite, type Plugin } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport, type Excuses } from '#lib/testing/check.js';
import { rewritePaste } from '#lib/testing.js';

function rewriting(name: string, ...into: ((body: string) => string | null)[]): Plugin {
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			rewrites: into.map((answer) =>
				rewrite({ from: builtin.blocks.paragraph, into: (block) => answer(block.body) })
			)
		})
	});
}

async function rowOf(run: Promise<CheckReport>) {
	try {
		return (await run).rows.find((row) => row.of === 'rewrite');
	} catch (error) {
		if (isCheckFailure(error)) return error.report.rows.find((row) => row.of === 'rewrite');
		throw error;
	}
}

describe('rewriteLands', () => {
	it('passes an answer that lands as a closed fence, at the top and inside a quote', async () => {
		const fenced = rewriting('fenced', (body) => `\`\`\`\n${body}\n\`\`\``);
		expect(await rowOf(check(fenced))).toMatchObject({
			subject: 'paragraph',
			status: 'passed',
			detail: expect.stringMatching(/^2 answer/)
		});
	});

	it('fails an answer that leaves a fence open, which swallows the block after it', async () => {
		const open = rewriting('open', (body) => `\`\`\`\n${body}`);
		const row = await rowOf(check(open));
		expect(row?.status).toBe('failed');
		expect(row?.detail).toMatch(/swallows the block pasted after it/);
	});

	it('fails an answer that still reads as the type it rewrites, so each paste grows it', async () => {
		const grows = rewriting('grows', (body) => `${body}!`);
		expect((await rowOf(check(grows)))?.detail).toMatch(/so each paste grows it/);
	});

	it('passes an answer that reads as the type but is answered the same again', async () => {
		const settles = rewriting('settles', (body) => body.toUpperCase());
		expect((await rowOf(check(settles)))?.status).toBe('passed');
	});

	it('reads not-applicable for a rewrite that keeps every sample', async () => {
		const keeps = rewriting('keeps', () => null);
		expect(await rowOf(check(keeps))).toMatchObject({ status: 'not-applicable' });
	});

	it('folds two rewrites of one type into one row: the first that answers writes', async () => {
		const two = rewriting(
			'two',
			() => null,
			(body) => `\`\`\`\n${body}`
		);
		const report = await check(two).catch((error: unknown) => {
			if (isCheckFailure(error)) return error.report;
			throw error;
		});
		const rows = report.rows.filter((row) => row.of === 'rewrite');
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('failed');
	});

	it('takes no excuse: the rewrites group types none', async () => {
		const open = rewriting('open-ok', (body) => `\`\`\`\n${body}`);
		const excuse: Excuses = {
			// @ts-expect-error: rewriteLands takes no excuse.
			rewrites: { paragraph: { rewriteLands: 'A fence it closes later.' } }
		};
		expect((await rowOf(check(open, { excuse })))?.detail).toMatch(/never covers this check/);
	});
});

describe('rewritePaste', () => {
	it('runs a plugin value’s rewrites over a clipboard that reads as blocks', () => {
		const loud = rewriting('loud', (body) => body.toUpperCase());
		expect(rewritePaste('quiet\n\n> also quiet\n', [loud])).toBe('QUIET\n\n> ALSO QUIET\n');
	});

	it('leaves the text alone with no plugin listed that rewrites it', () => {
		expect(rewritePaste('quiet\n', [])).toBe('quiet\n');
	});
});
