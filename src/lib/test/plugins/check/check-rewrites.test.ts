// @vitest-environment node
// `check` pastes each type a plugin rewrites, at the top and inside a container, alone, with a block
// flush below it and with one flush above: an answer lands as blocks of its own, each neighbour keeps
// its bytes, and a paste of the answer isn't rewritten again. It pastes a whole-paste rewrite's
// sample at the top and inside a quote. `rewritePaste` runs the same production function over a
// plugin list.
import { describe, expect, it } from 'vitest';
import {
	blockRewrite,
	builtin,
	definePlugin,
	pasteRewrite,
	type Editor,
	type Plugin
} from '#lib/plugin.js';
import type { Doc } from '#lib/schema/doc-view.js';
import { check, isCheckFailure, type CheckReport, type Excuses } from '#lib/testing/check.js';
import { rewritePaste } from '#lib/testing.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

function rewriting(name: string, ...into: ((body: string) => string | null)[]): Plugin {
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blockRewrites: into.map((answer) =>
				blockRewrite({ from: builtin.blocks.paragraph, into: (block) => answer(block.body) })
			)
		})
	});
}

/** A plugin of one whole-paste rewrite named `name`. */
function wholeRewriting(
	plugin: string,
	into: (pasted: Doc, editor: Editor) => string | null,
	{ name = 'all', sample = 'wow!! ok' } = {}
): Plugin {
	return definePlugin({
		name: plugin,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			pasteRewrites: [
				pasteRewrite({ name, sample, into: (pasted, { editor }) => into(pasted, editor) })
			]
		})
	});
}

const reportOf = (run: Promise<CheckReport>) =>
	run.catch((error: unknown) => {
		if (isCheckFailure(error)) return error.report;
		throw error;
	});

async function rowOf(run: Promise<CheckReport>, of = 'blockRewrite') {
	return (await reportOf(run)).rows.find((row) => row.of === of);
}

describe('rewriteLands', () => {
	it('passes an answer that lands as a closed fence, at the top and inside a quote', async () => {
		const fenced = rewriting('fenced', (body) => `\`\`\`\n${body}\n\`\`\``);
		expect(await rowOf(check(fenced))).toMatchObject({
			subject: 'paragraph',
			status: 'passed',
			detail: expect.stringMatching(/^6 answer/)
		});
	});

	// Miss-analysis: every paste had a block flush below the sample, so a rewrite that answers only
	// a block pasted alone was never asked about its answer.
	it('passes a rewrite that answers a block pasted alone, deciding on `pasted`', async () => {
		const lone = definePlugin({
			name: 'lone',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blockRewrites: [
					blockRewrite({
						from: builtin.blocks.heading,
						into: (block, { pasted }) => (pasted.blocks.length === 1 ? `> ${block.body}` : null)
					})
				]
			})
		});
		expect(await rowOf(check(lone))).toMatchObject({
			subject: 'heading',
			status: 'passed',
			detail: expect.stringMatching(/^4 answer/)
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

	it('passes an empty answer, which takes the block out', async () => {
		const gone = rewriting('gone', () => '');
		expect((await rowOf(check(gone)))?.status).toBe('passed');
	});

	// Miss-analysis: the row asked only that the last block stay a paragraph, so an answer the paste
	// let read into the paragraph beside it passed.
	it('passes a heading rewritten to its text, which the paste sets apart from both neighbours', async () => {
		const flat = definePlugin({
			name: 'flat',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blockRewrites: [blockRewrite({ from: builtin.blocks.heading, into: (block) => block.body })]
			})
		});
		expect(await rowOf(check(flat))).toMatchObject({
			subject: 'heading',
			status: 'passed',
			detail: expect.stringMatching(/^6 answer/)
		});
		expect(rewritePaste('Above.\n# Title\nBelow.\n', [flat])).toBe('Above.\n\nTitle\n\nBelow.\n');
	});

	it('passes an answer of two blocks, at the top and inside a quote', async () => {
		const split = definePlugin({
			name: 'split',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blockRewrites: [blockRewrite({ from: builtin.blocks.heading, into: () => 'one\n\ntwo' })]
			})
		});
		expect(await rowOf(check(split))).toMatchObject({ subject: 'heading', status: 'passed' });
	});

	// Miss: no fixture's `into` threw; the editor keeps the block and reports it, and the row heard
	// only the kept block, so it read as a rewrite with nothing to do.
	it('fails a rewrite that throws, which the editor reports and keeps the block for', async () => {
		const throws = rewriting('throws', () => {
			throw new Error('no answer for you');
		});
		expect(await rowOf(check(throws))).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/the editor reported your plugin.*no answer for you/)
		});
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
		const rows = report.rows.filter((row) => row.of === 'blockRewrite');
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('failed');
	});

	it('takes no excuse: the blockRewrites group types none', async () => {
		const open = rewriting('open-ok', (body) => `\`\`\`\n${body}`);
		const excuse: Excuses = {
			// @ts-expect-error: rewriteLands takes no excuse.
			blockRewrites: { paragraph: { rewriteLands: 'A fence it closes later.' } }
		};
		expect((await rowOf(check(open, { excuse })))?.detail).toMatch(/never covers this check/);
	});
});

describe('rewriteLands for a whole-paste rewrite', () => {
	const shout = (pasted: Doc) => (pasted.text.includes('!!') ? pasted.text.toUpperCase() : null);

	it("passes the guide's shout, under its plugin's name", async () => {
		const plugin = wholeRewriting('shout', shout, { name: 'shout' });
		expect(await rowOf(check(plugin), 'pasteRewrite')).toMatchObject({
			subject: 'shout/shout',
			check: 'rewriteLands',
			status: 'passed'
		});
	});

	it('fails a sample its rewrite keeps', async () => {
		const keeps = wholeRewriting('keeps', shout, { sample: 'calm' });
		expect(await rowOf(check(keeps), 'pasteRewrite')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/keeps its own sample "calm" pasted at the top/)
		});
	});

	it('fails an answer a paste of which is rewritten again', async () => {
		const grows = wholeRewriting('grows', (pasted) => `${pasted.text}!`);
		expect(await rowOf(check(grows), 'pasteRewrite')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/is rewritten again: "wow!! ok!" becomes "wow!! ok!!"/)
		});
	});

	it('fails a rewrite that keeps its sample pasted inside a quote', async () => {
		const top = wholeRewriting('top', (pasted, editor) =>
			editor.doc.text.startsWith('>') ? null : pasted.text.toUpperCase()
		);
		expect(await rowOf(check(top), 'pasteRewrite')).toMatchObject({
			status: 'failed',
			detail: 'it keeps its own sample "wow!! ok" pasted inside a quote'
		});
	});

	it('hands the rewrite an editor with a caret where the paste lands', async () => {
		const caret = wholeRewriting('caret', (pasted, editor) =>
			editor.selection ? pasted.text.toUpperCase() : null
		);
		expect((await rowOf(check(caret), 'pasteRewrite'))?.status).toBe('passed');
	});

	it('fails a rewrite with no sample', async () => {
		const bare = wholeRewriting('bare', shout, { sample: '' });
		expect(await rowOf(check(bare), 'pasteRewrite')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/lists no sample/)
		});
	});

	it('keys its row and its excuse apart from a rewrite of the type it is named for', async () => {
		const both = definePlugin({
			name: 'both',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				pasteRewrites: [pasteRewrite({ name: 'paragraph', sample: 'a!!', into: (p) => shout(p) })],
				blockRewrites: [
					blockRewrite({ from: builtin.blocks.paragraph, into: (block) => `\`\`\`\n${block.body}` })
				]
			})
		});
		const excuse: Excuses = {
			// @ts-expect-error: rewriteLands takes no excuse.
			pasteRewrites: { paragraph: { rewriteLands: 'A fence it closes later.' } }
		};
		const rows = (await reportOf(check(both, { excuse }))).rows.filter(
			(row) => row.check === 'rewriteLands'
		);
		expect(rows.map(({ of, subject, status }) => [of, subject, status])).toEqual([
			['pasteRewrite', 'both/paragraph', 'failed'],
			['blockRewrite', 'paragraph', 'failed']
		]);
		expect(rows[0].detail).toMatch(/never covers this check/);
		expect(rows[1].detail).toMatch(/swallows the block pasted after it/);
	});
});

describe('rewritePaste', () => {
	it('runs the whole-paste rewrites, then those by type over what they left', () => {
		const both = definePlugin({
			name: 'both',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				pasteRewrites: [
					pasteRewrite({ name: 'loud', sample: 'x', into: (p) => p.text.toUpperCase() })
				],
				blockRewrites: [
					blockRewrite({
						from: builtin.blocks.heading,
						into: (block, { pasted }) => `# ${block.body} of ${pasted.blocks.length}`
					})
				]
			})
		});
		expect(rewritePaste('# quiet\n\nand more\n', [both])).toBe('# QUIET of 2\n\nAND MORE\n');
	});

	// Miss-analysis: the version-range row pinned an `install` report, which every other `install`
	// report gives for a plugin left out, and counted no reports per call.
	it('reports a plugin made for another editor once a call, as running anyway', () => {
		const old = definePlugin({
			name: 'old',
			version: '1.0.0',
			editor: '^99.0.0',
			contributes: () => ({
				blockRewrites: [
					blockRewrite({ from: builtin.blocks.heading, into: (block) => block.text.toUpperCase() })
				]
			})
		});
		for (let call = 0; call < 2; call++) {
			expect(rewritePaste('# quiet please\n', [old])).toBe('# QUIET PLEASE\n');
			expect(takeDevWarns().map(({ tag, message }) => [tag, message])).toEqual([
				[
					'plugin-error',
					expect.stringMatching(
						/^plugin 'old' \(version check\): plugin 'old' asks for editor \^99\.0\.0, and this is .+; it runs anyway$/
					)
				]
			]);
		}
	});

	it('runs a plugin value’s rewrites over a clipboard that reads as blocks', () => {
		const loud = rewriting('loud', (body) => body.toUpperCase());
		expect(rewritePaste('quiet\n\n> also quiet\n', [loud])).toBe('QUIET\n\n> ALSO QUIET\n');
	});

	it('leaves the text alone with no plugin listed that rewrites it', () => {
		expect(rewritePaste('quiet\n', [])).toBe('quiet\n');
	});
});
