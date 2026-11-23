// @vitest-environment node
// G1.233: `check` runs every check over every sample of every block type a plugin value lists, with
// no DOM; an excuse that doesn't stand, or a dev warning, fails the run.
import { afterEach, describe, expect, it } from 'vitest';
import {
	command,
	container,
	definePlugin,
	fencedBlock,
	lineBlock,
	type Plugin
} from '#lib/plugin.js';
import { configureEditorEnv, resetEditorEnv } from '#lib/testing.js';
import { devWarn } from '#lib/dev-checks.js';
import {
	check,
	CheckFailure,
	isCheckFailure,
	type CheckReport,
	type Excuses
} from '#lib/testing/check.js';

const NOT_INSERTED = { none: 'a fixture of the check suite' };

const memo = lineBlock({
	name: 'memo',
	label: 'Memo',
	sample: ['%%a memo', '%%another'],
	insert: NOT_INSERTED,
	match: /^%%(?<text>.*)$/
});

const MARKED = { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true } as const;

const callout = container({
	name: 'callout',
	label: 'Callout',
	sample: '%> one\n%>\n%> two',
	insert: NOT_INSERTED,
	lines: MARKED
});

function pluginOf(name: string, contributes: () => object): Plugin {
	return definePlugin({ name, version: '1.0.0', editor: '*', contributes });
}

/** The run's report, resolved or carried by its failure. */
async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	try {
		return await run;
	} catch (error) {
		if (isCheckFailure(error)) return error.report;
		throw error;
	}
}

const statuses = (report: CheckReport, subject?: string) =>
	Object.fromEntries(
		report.rows
			.filter((row) => subject === undefined || row.subject === subject)
			.map((row) => [row.check, row.status])
	);

const rowOf = (report: CheckReport, check: string) => report.rows.find((r) => r.check === check);

afterEach(() => resetEditorEnv());

describe('check over block types', () => {
	it('runs the block checks over a line block, in plain Node', async () => {
		expect(typeof document).toBe('undefined');
		const report = await check(pluginOf('memos', () => ({ blocks: [memo] })));
		expect(report.plugin).toBe('memos');
		expect(statuses(report, 'memos')).toEqual({ install: 'passed', setup: 'not-applicable' });
		expect(statuses(report, 'memos/memo')).toEqual({
			sample: 'passed',
			roundTrip: 'passed',
			focus: 'unchecked',
			mergeBackspace: 'passed',
			selectionPaint: 'unchecked',
			search: 'not-applicable',
			searchPaint: 'unchecked',
			reorder: 'unchecked',
			undo: 'passed',
			clipboard: 'passed',
			simOracle: 'unchecked',
			rawWrite: 'passed',
			unfinishedReading: 'not-applicable',
			completion: 'not-applicable',
			dataWriteback: 'not-applicable',
			docPositions: 'passed'
		});
		expect(rowOf(report, 'focus')?.detail).toMatch(/^needs a browser/);
	});

	it('runs the container checks over a container, every one on fixtures its sample gives', async () => {
		const report = await check(pluginOf('boxes', () => ({ blocks: [callout] })));
		const rows = statuses(report, 'boxes/callout');
		expect(rows).toMatchObject({
			sample: 'passed',
			roundTrip: 'passed',
			localIndex: 'passed',
			ancestry: 'passed',
			focusBubble: 'passed',
			openerLine: 'not-applicable',
			containerCopy: 'passed',
			containerDeclared: 'passed'
		});
		expect(rows).not.toHaveProperty('multiScope');
	});

	// The editor keeps a head line as spelled, so a writer that spells another passed every check
	// that reads the sample; only a container the editor writes afresh met it.
	it("fails containerDeclared for a head line its own match doesn't read back", async () => {
		const flag = container({
			name: 'flag',
			label: 'Flag',
			sample: '%> [!NOTE]\n%> x',
			insert: NOT_INSERTED,
			lines: {
				...MARKED,
				head: {
					match: /^\[!(\w+)\]$/,
					data: (m: RegExpExecArray) => ({ type: m[1] }),
					write: (data: { type: string }) => `[${data.type}]`
				}
			}
		});
		const report = await reportOf(check(pluginOf('flags', () => ({ blocks: [flag] }))));
		expect(rowOf(report, 'sample')?.status).toBe('passed');
		expect(rowOf(report, 'containerDeclared')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/head\.write gives "\[NOTE\]" .* head\.match doesn't read back/)
		});
	});

	// G1.191 refuses the shape where the editor holds it, so the check reports what the editor said.
	it("fails install for a container whose reads can't read its own first marker", async () => {
		const cut = container({
			name: 'cut',
			label: 'Cut',
			sample: '%> one',
			insert: NOT_INSERTED,
			lines: { ...MARKED, reads: /^%>/ }
		});
		const report = await reportOf(check(pluginOf('cuts', () => ({ blocks: [cut] }))));
		expect(report.rows).toEqual([
			expect.objectContaining({
				check: 'install',
				status: 'failed',
				detail: expect.stringMatching(/`reads` must read the marker "%> " whole/)
			})
		]);
	});

	it('fails sample for a block type with no sample, and runs nothing else on it', async () => {
		const bare = lineBlock({
			name: 'bare',
			label: 'Bare',
			match: /^%%$/,
			insert: NOT_INSERTED
		} as never);
		const report = await reportOf(check(pluginOf('bares', () => ({ blocks: [bare] }))));
		expect(statuses(report, 'bares/bare')).toEqual({ sample: 'failed' });
		expect(rowOf(report, 'sample')?.detail).toMatch(/lists no sample/);
	});

	it.each([
		['reads as another type', 'just a paragraph', /reads as a "paragraph" first/],
		['nests the type', '> %%nested', /reads as a "blockquote" first/]
	])('fails sample for a sample that %s', async (_name, sample, message) => {
		const drifted = lineBlock({
			name: 'drift',
			label: 'Drift',
			sample,
			insert: NOT_INSERTED,
			match: /^%%(?<text>.*)$/
		});
		const report = await reportOf(check(pluginOf('drifts', () => ({ blocks: [drifted] }))));
		expect(rowOf(report, 'sample')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(message)
		});
	});

	// The fence never closes, so it reads the kit's sentinel into itself and deleting a document's
	// only block still pushes an undo entry.
	it('fails undo for a sample that swallows the block put after it', async () => {
		const open = fencedBlock({
			name: 'open',
			label: 'Open',
			sample: '```demo\nx',
			insert: NOT_INSERTED,
			fence: { info: 'demo' }
		});
		const report = await reportOf(check(pluginOf('opens', () => ({ blocks: [open] }))));
		expect(rowOf(report, 'undo')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/trailing sentinel/)
		});
	});

	// The maker derives a fence's reading, so the row holds the derivation a hand-made opener declared.
	it('reads a fenced block that waits on its own closer as one that closes', async () => {
		const fixed = fencedBlock({
			name: 'fixed',
			label: 'Fixed',
			sample: '@@@\nx\n@@@',
			insert: NOT_INSERTED,
			fence: { open: /^@@@$/, close: '@@@' }
		});
		const report = await reportOf(check(pluginOf('fixeds', () => ({ blocks: [fixed] }))));
		expect(rowOf(report, 'unfinishedReading')?.status).toBe('passed');
	});

	it('runs every sample, and names the one a check failed on', async () => {
		const two = fencedBlock({
			name: 'two',
			label: 'Two',
			sample: ['```demo\nx\n```', '```demo\nx'],
			insert: NOT_INSERTED,
			fence: { info: 'demo' }
		});
		const report = await reportOf(check(pluginOf('twos', () => ({ blocks: [two] }))));
		expect(rowOf(report, 'sample')?.status).toBe('passed');
		expect(rowOf(report, 'undo')?.detail).toMatch(/^sample 2: .*trailing sentinel/);
	});
});

describe('check over the plugin', () => {
	const strict = definePlugin<{ level: number; twice: boolean }>({
		name: 'strict',
		version: '1.0.0',
		editor: '*',
		defaults: { level: 0, twice: false },
		validate: ({ level }) => (level > 0 ? undefined : 'level has to be above zero'),
		contributes: ({ twice }) => {
			const go = () => command({ id: 'go', title: 'Go', run: () => true });
			return { commands: twice ? [go(), go()] : [] };
		}
	});

	it('fails install for a plugin whose defaults fail its own validate', async () => {
		const report = await reportOf(check(strict));
		expect(rowOf(report, 'install')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/validate: level has to be above zero/)
		});
	});

	// Miss: `strict` only ever ran bare. `install` holds the defaults beside the options handed, so a
	// plugin with a required option failed a row no excuse covers, whatever it was handed.
	it('passes install for a required option handed, saying its defaults alone are refused', async () => {
		const report = await check(strict, { options: { level: 2 } });
		expect(rowOf(report, 'install')).toMatchObject({
			status: 'passed',
			detail:
				'installs with your options; its defaults alone are refused (validate: level has to be above zero)'
		});
	});

	it('still fails install where the options handed are refused, or anything else is wrong', async () => {
		const refused = await reportOf(check(strict, { options: { level: -1 } }));
		expect(rowOf(refused, 'install')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/^validate: level has to be above zero/)
		});
		const clashing = await reportOf(check(strict, { options: { level: 2, twice: true } }));
		expect(rowOf(clashing, 'install')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/lists two commands with the id/)
		});
	});

	// Two editors hold one block type by name, so its facts can't follow their options.
	it('fails install for a block type whose facts differ by option, holding both at once', async () => {
		const shifty = definePlugin<{ object: boolean }>({
			name: 'shifty',
			version: '1.0.0',
			editor: '*',
			defaults: { object: false },
			contributes: ({ object }) => ({
				blocks: [
					lineBlock({
						name: 'line',
						label: 'Line',
						sample: '%%x',
						insert: NOT_INSERTED,
						match: /^%%(?<text>.*)$/,
						role: object ? 'object' : 'prose'
					})
				]
			})
		});
		expect(rowOf(await check(shifty), 'install')?.status).toBe('passed');
		const report = await reportOf(check(shifty, { options: { object: true } }));
		expect(rowOf(report, 'install')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/dev warning \[block-type-facts\]/)
		});
	});

	// A block type is the first listing plugin's: the install leaves a borrowed one out.
	it('fails install over a block type another plugin made, and checks nothing of it', async () => {
		await check(pluginOf('memos', () => ({ blocks: [memo] })));
		const report = await reportOf(check(pluginOf('borrows', () => ({ blocks: [memo] }))));
		expect(report.rows.map((row) => `${row.check}:${row.status}`)).toEqual([
			'install:failed',
			'setup:not-applicable'
		]);
		expect(report.rows[0].detail).toMatch(
			/lists the block type 'memos\/memo', which plugin 'memos'/
		);
	});

	it('reads setup as unchecked with no DOM, naming the DOM', async () => {
		const touches = pluginOf('touches', () => ({ setup: () => void document.title }));
		expect(rowOf(await check(touches), 'setup')).toMatchObject({
			status: 'unchecked',
			detail: expect.stringMatching(/^needs a DOM/)
		});
	});

	it('fails on a dev warning raised during the run, unless told not to', async () => {
		const noisy = pluginOf('noisy', () => (devWarn('noisy-tag', 'something to see'), {}));
		const failure = await check(noisy).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(CheckFailure);
		expect((failure as CheckFailure).message).toMatch(
			/dev warning \[noisy-tag\]: something to see/
		);
		const quiet = await check(noisy, { warningsFail: false });
		expect(quiet.warnings).toEqual([{ tag: 'noisy-tag', message: 'something to see' }]);
	});

	it('fails on a dev warning raised while a check reads, though no row fails', async () => {
		const warns = lineBlock({
			name: 'warns',
			label: 'Warns',
			sample: '%%w',
			insert: NOT_INSERTED,
			match: (line) => {
				if (!line.startsWith('%%')) return null;
				devWarn('read-tag', 'read once');
				return { text: [2, line.length] };
			}
		});
		const failure = (await check(pluginOf('warners', () => ({ blocks: [warns] }))).catch(
			(error: unknown) => error
		)) as CheckFailure;
		expect(failure.report.rows.filter((row) => row.status === 'failed')).toEqual([]);
		expect(failure.message).toMatch(/dev warning \[read-tag\]: read once/);
	});

	it('refuses to run with dev checks off, since a warning would pass unseen', async () => {
		configureEditorEnv({ isDev: false });
		await expect(check(pluginOf('off', () => ({})))).rejects.toThrow(/dev checks are off/);
	});

	it('names each failed row and the contract it breaks', async () => {
		const failure = (await check(
			pluginOf('drifts', () => ({
				blocks: [
					lineBlock({ name: 'd', label: 'D', sample: 'text', insert: NOT_INSERTED, match: /^%%$/ })
				]
			}))
		).catch((e: unknown) => e)) as Error;
		expect(failure.message).toMatch(
			/check failed for plugin 'drifts':\n {2}- block drifts\/d sample: .*\n {4}breaks: each block type has a sample, and each reads as that type first \(plugin-testing\.md#checking-a-plugin-value-check\)/
		);
	});

	// A failure crosses two copies of the entry, a plugin's tests and the bin, so it's told by a mark.
	it('tells a failure from another copy of the entry by its mark', () => {
		const report: CheckReport = {
			plugin: 'p',
			version: '1.0.0',
			editor: '0.0.0',
			rows: [],
			warnings: []
		};
		const theirs = Object.assign(new Error('x'), { report });
		Object.defineProperty(theirs, Symbol.for('@voithos-labs/aragonite:check-failure'), {
			value: true
		});
		expect(isCheckFailure(theirs)).toBe(true);
		expect(isCheckFailure(new Error('x'))).toBe(false);
		expect(isCheckFailure(new CheckFailure(report))).toBe(true);
	});
});

describe('an excuse is a claim', () => {
	const leaky = lineBlock({
		name: 'leaky',
		label: 'Leaky',
		sample: '%%leaky',
		insert: NOT_INSERTED,
		match: /^%%(?<text>.*)$/
	});
	const leaks = pluginOf('leaks', () => ({ blocks: [leaky] }));
	const REASON = 'the block is copied whole by a command of its own, never by a range';

	it.each<[string, Excuses, RegExp]>([
		[
			'a check that passed',
			{ blocks: { leaky: { clipboard: REASON } } },
			/it passed: drop the excuse/
		],
		[
			'a subject the plugin lists none of',
			{ blocks: { ghost: { undo: REASON } } },
			/no check runs on a block named "ghost"/
		],
		[
			'a check that never runs on the subject',
			{ blocks: { leaky: { localIndex: REASON } } },
			/it never runs on this block/
		],
		[
			'a reason that is no sentence',
			{ blocks: { leaky: { undo: 'n/a' } } },
			/the reason has to be a sentence/
		]
	])('fails over %s', async (_name, excuse, message) => {
		const report = await reportOf(check(leaks, { excuse }));
		expect(report.rows.filter((row) => row.status === 'failed')).toEqual([
			expect.objectContaining({ detail: expect.stringMatching(message) })
		]);
	});

	it('fails over a check no excuse covers, spelled by a JavaScript author', async () => {
		const excuse = {
			blocks: { leaky: { roundTrip: REASON, roundtrip: REASON } }
		} as unknown as Excuses;
		const report = await reportOf(check(leaks, { excuse }));
		expect(report.rows.filter((row) => row.status === 'failed').map((row) => row.detail)).toEqual([
			'excused, but an excuse never covers this check',
			'excused, but no check is named "roundtrip"'
		]);
	});

	it('covers a failing excusable check, keeping what it found', async () => {
		const open = fencedBlock({
			name: 'open',
			label: 'Open',
			sample: '```demo\nx',
			insert: NOT_INSERTED,
			fence: { info: 'demo' }
		});
		const opens = pluginOf('opens', () => ({ blocks: [open] }));
		const report = await reportOf(check(opens, { excuse: { blocks: { open: { undo: REASON } } } }));
		expect(rowOf(report, 'undo')).toMatchObject({
			status: 'excused',
			detail: expect.stringMatching(/^the block is copied whole .*\(it found: .*trailing sentinel/)
		});
	});
});

// Rows the type checker reads and never runs: each `@ts-expect-error` fails `npm run check` the day
// its excuse compiles again.
export function excusesThatDontCompile(): Excuses[] {
	return [
		// @ts-expect-error a misspelt check name
		{ blocks: { memo: { mergeBackspce: 'a sentence long enough to count as one' } } },
		// @ts-expect-error a check no excuse covers
		{ blocks: { memo: { roundTrip: 'a sentence long enough to count as one' } } },
		// @ts-expect-error no plugin check takes an excuse
		{ plugin: { install: 'a sentence long enough to count as one' } },
		// @ts-expect-error claims takes no excuse
		{ inlines: { tag: { claims: 'a sentence long enough to count as one' } } },
		// @ts-expect-error the editor's decline over a bracket takes no excuse
		{ inlines: { tag: { inlineDecline: 'a sentence long enough to count as one' } } }
	];
}

/** The excuses that do compile: one per namespace with an excusable check. */
export function excusesThatCompile(): Excuses[] {
	return [
		{ blocks: { memo: { undo: 'a sentence long enough to count as one' } } },
		{ inlines: { tag: { widget: 'a sentence long enough to count as one', editingPolicy: 'x' } } }
	];
}
