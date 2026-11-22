// @vitest-environment node
// `check` reads what a block type reads and writes besides its bytes: a completion's lines and caret,
// the data it writes back, and where its blocks, text and pieces sit in the parsed document.
import { describe, expect, it } from 'vitest';
import { definePlugin, lineBlock } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

const NOT_INSERTED = { none: 'a fixture of the check suite' };

async function rowOf(run: Promise<CheckReport>, name: string) {
	let report: CheckReport;
	try {
		report = await run;
	} catch (error) {
		if (!isCheckFailure(error)) throw error;
		report = error.report;
	}
	return report.rows.find((row) => row.of === 'block' && row.check === name);
}

function memoPlugin(name: string, spec: object) {
	const memo = lineBlock({
		name: 'memo',
		label: 'Memo',
		sample: '%%a *memo*',
		insert: NOT_INSERTED,
		body: 'markdown',
		match: /^%%(?<text>.*)$/,
		...spec
	} as Parameters<typeof lineBlock>[0]);
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [memo] })
	});
}

describe('docPositions', () => {
	it('passes a line block whose text, bytes and pieces sit where it reads them', async () => {
		expect(await rowOf(check(memoPlugin('placed', {})), 'docPositions')).toMatchObject({
			status: 'passed'
		});
	});

	it('fails a match function whose text range runs backwards', async () => {
		const backwards = memoPlugin('backwards', {
			match: (line: string) => (line.startsWith('%%') ? { text: [6, 2] } : null)
		});
		expect((await rowOf(check(backwards), 'docPositions'))?.detail).toMatch(/runs backwards/);
	});

	it('fails a match function whose text range leaves its line', async () => {
		const past = memoPlugin('past', {
			match: (line: string) => (line.startsWith('%%') ? { text: [2, line.length + 3] } : null)
		});
		expect((await rowOf(check(past), 'docPositions'))?.detail).toMatch(/leaves its 10-byte line/);
	});
});

describe('dataWriteback', () => {
	const levelled = (write: (data: { level: number }, text: string) => string) => ({
		sample: '%%2 a memo',
		match: /^%%(?<level>\d) (?<text>.*)$/,
		data: (m: RegExpExecArray) => ({ level: Number(m.groups!.level) }),
		write
	});

	it('passes a writer that puts back the line it read', async () => {
		const exact = memoPlugin(
			'exact',
			levelled((d, text) => `%%${d.level} ${text}`)
		);
		expect((await rowOf(check(exact), 'dataWriteback'))?.status).toBe('passed');
	});

	it('fails a writer whose unchanged data rewrites the bytes', async () => {
		const spaced = memoPlugin(
			'spaced',
			levelled((d, text) => `%%${d.level}  ${text}`)
		);
		expect((await rowOf(check(spaced), 'dataWriteback'))?.detail).toMatch(
			/rewrites its bytes: "%%2 {2}a memo\\n"/
		);
	});

	it('reads not-applicable for a type with no writer', async () => {
		expect((await rowOf(check(memoPlugin('plain', {})), 'dataWriteback'))?.status).toBe(
			'not-applicable'
		);
	});
});

describe('completion', () => {
	const completing = (caret: { line: number; col: number }, line = /^%%$/) => ({
		complete: { on: 'typed', line, complete: () => ({ lines: ['%%note'], caret }) }
	});

	it('passes a completion a prefix of the sample reaches, its caret on its lines', async () => {
		const good = memoPlugin('good', completing({ line: 0, col: 6 }));
		expect((await rowOf(check(good), 'completion'))?.status).toBe('passed');
	});

	it('fails a completion that puts the caret past its lines', async () => {
		const outside = memoPlugin('outside', completing({ line: 1, col: 0 }));
		expect((await rowOf(check(outside), 'completion'))?.detail).toMatch(/caret outside the lines/);
	});

	it('fails, excusably, a completion no prefix of a sample reaches', async () => {
		const never = memoPlugin('never', completing({ line: 0, col: 0 }, /^@@$/));
		expect((await rowOf(check(never), 'completion'))?.detail).toMatch(/no prefix/);
		const excuse = { blocks: { memo: { completion: 'It completes a spelling no sample uses.' } } };
		expect((await rowOf(check(never, { excuse }), 'completion'))?.status).toBe('excused');
	});
});
