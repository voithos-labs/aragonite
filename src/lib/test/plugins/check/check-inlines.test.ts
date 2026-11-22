// @vitest-environment node
// G1.233: `check` runs every inline check over every sample of every `inline()`, `mark()` and marker
// pair a plugin value lists, the checks each shape takes, and fails a row a broken construct breaks.
import { afterEach, describe, expect, it } from 'vitest';
import { builtin, definePlugin, inline, mark, markerPair, type Plugin } from '#lib/plugin.js';
import type { Contribution } from '#lib/schema/plugin-unit.js';
import { resetEditorEnv } from '#lib/testing.js';
import { check, isCheckFailure, type CheckReport, type Excuses } from '#lib/testing/check.js';

const DRAWN = {
	widget: { delete: 'whole', arrows: 'over', click: 'none' },
	draw: () => ({})
} as const;

const formula = (over: object = {}) =>
	inline({
		name: 'formula',
		label: 'Formula',
		prefix: '$',
		sample: 'a $x$ b',
		match: /\$([^$\n]+)\$/,
		read: (m) => m[1],
		...DRAWN,
		...over
	});

const mention = (over: object = {}) =>
	inline({
		name: 'mention',
		label: 'Mention',
		prefix: '@',
		sample: 'hi @ann',
		match: /@(\w+)/,
		read: (m) => m[1],
		class: 'mention',
		...over
	});

type Embed = { src: string; width: number | null };
const embed = (write: (image: { src: string; width: number | null }) => string) =>
	inline<Embed>({
		name: 'embed',
		label: 'Embed',
		prefix: '![[',
		sample: '![[cat.png|300]]',
		match: /!\[\[([^|\]]+)(?:\|(\d+))?\]\]/,
		read: (m) => ({ src: m[1], width: m[2] ? Number(m[2]) : null }),
		as: 'image',
		image: (d) => ({ src: d.src, alt: d.src, title: null, width: d.width, height: null }),
		write
	});

const note = inline({
	name: 'note',
	label: 'Note',
	prefix: '[[',
	sample: 'see [[note]]',
	match: /\[\[([^\]]+)\]\]/,
	read: (m) => m[1],
	as: 'link',
	link: (d) => ({ href: d, text: d, title: null }),
	write: (l) => `[[${l.text}]]`
});

const highlight = (over: object = {}) =>
	mark({
		name: 'hl',
		label: 'Highlight',
		marker: '==',
		chord: 'Mod+Shift+H',
		sample: 'a ==b== c',
		...over
	});

const comment = (over: object = {}) =>
	markerPair<string>({
		name: 'cm',
		label: 'Comment',
		open: { prefix: '{>>', match: /\{>>(\w+)\}/, read: (m) => m[1] },
		close: { prefix: '{<<', match: /\{<<(\w+)\}/, read: (m) => m[1] },
		key: (id) => id,
		sample: '{>>a}one\n\ntwo{<<a}',
		...over
	});

function pluginOf(name: string, inlines: () => unknown[]): Plugin {
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ inlines: inlines() as Contribution['inlines'] })
	});
}

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	try {
		return await run;
	} catch (error) {
		if (isCheckFailure(error)) return error.report;
		throw error;
	}
}

const statuses = (report: CheckReport, subject: string) =>
	Object.fromEntries(
		report.rows.filter((row) => row.subject === subject).map((row) => [row.check, row.status])
	);

const rowOf = (report: CheckReport, subject: string, check: string) =>
	report.rows.find((row) => row.subject === subject && row.check === check);

afterEach(() => resetEditorEnv());

describe('check over inline constructs', () => {
	it('runs the checks each shape takes, in plain Node', async () => {
		expect(typeof document).toBe('undefined');
		const report = await check(
			pluginOf('shapes', () => [
				formula(),
				mention(),
				embed((i) => `![[${i.src}|${i.width}]]`),
				note,
				highlight(),
				comment()
			])
		);
		expect(statuses(report, 'shapes/formula')).toEqual({
			sample: 'passed',
			claims: 'passed',
			roundTrip: 'passed',
			inlineDecline: 'not-applicable',
			widget: 'passed',
			editingPolicy: 'passed',
			inlinePlace: 'not-applicable',
			dependsContent: 'not-applicable'
		});
		expect(statuses(report, 'shapes/mention')).toEqual({
			sample: 'passed',
			claims: 'passed',
			roundTrip: 'passed',
			inlineDecline: 'not-applicable',
			inlinePlace: 'not-applicable'
		});
		expect(statuses(report, 'shapes/embed')).toMatchObject({
			inlineDecline: 'passed',
			inlineWriter: 'passed'
		});
		expect(statuses(report, 'shapes/note')).toMatchObject({
			inlineDecline: 'passed',
			inlineWriter: 'passed'
		});
		expect(statuses(report, 'shapes/hl')).toEqual({
			sample: 'passed',
			claims: 'passed',
			roundTrip: 'passed',
			inlinePlace: 'not-applicable'
		});
		expect(statuses(report, 'shapes/cm')).toEqual({
			sample: 'passed',
			claims: 'passed',
			roundTrip: 'passed',
			inlineDecline: 'not-applicable',
			pairSides: 'passed'
		});
	});

	it('fails sample for a construct with no sample, and runs nothing else on it', async () => {
		const report = await reportOf(check(pluginOf('bare', () => [mention({ sample: [] })])));
		expect(statuses(report, 'bare/mention')).toEqual({ sample: 'failed' });
	});

	it('fails claims for a sample no claim reads, naming it', async () => {
		const report = await reportOf(
			check(pluginOf('some', () => [mention({ sample: ['hi @ann', 'plain prose'] })]))
		);
		expect(rowOf(report, 'some/mention', 'claims')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/"plain prose" holds no claim of "some\/mention"/)
		});
		expect(statuses(report, 'some/mention')).toEqual({ sample: 'passed', claims: 'failed' });
	});

	it('fails claims, rather than throwing, for a matcher that claims past its text', async () => {
		const runaway = formula({ match: (text: string) => text.length + 2, read: () => 'x' });
		const report = await reportOf(check(pluginOf('runaway', () => [runaway])));
		expect(rowOf(report, 'runaway/formula', 'claims')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/past the scan range end/)
		});
	});

	// The match ignores `end`, so where a block's scan range stops short of its text it reads past.
	it('fails roundTrip for a function matcher that reads past the range it was given', async () => {
		const overrun = formula({
			match: (text: string, at: number) => {
				const close = text.indexOf('$', at + 1);
				return close > at + 1 ? close + 1 : -1;
			},
			read: (claim: string) => claim.slice(1, -1)
		});
		const report = await reportOf(check(pluginOf('runs', () => [overrun])));
		expect(rowOf(report, 'runs/formula', 'roundTrip')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/past the scan range end/)
		});
	});

	// Both sides share the sample's one line, so only a cut after the open's own prefix reaches it.
	it("fails roundTrip for a pair's open side that reads past its range", async () => {
		const overrun = comment({
			sample: '{>>a}text{<<a}',
			open: {
				prefix: '{>>',
				match: (text: string, at: number) => {
					const close = text.indexOf('}', at);
					return text.startsWith('{>>', at) && close > at + 3 ? close + 1 : -1;
				},
				read: (claim: string) => claim.slice(3, -1)
			}
		});
		const report = await reportOf(check(pluginOf('pairs', () => [overrun])));
		expect(rowOf(report, 'pairs/cm', 'roundTrip')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/past the scan range end/)
		});
	});

	it('fails inlineWriter for an image write that drops the width', async () => {
		const report = await reportOf(check(pluginOf('pics', () => [embed((i) => `![[${i.src}]]`)])));
		expect(rowOf(report, 'pics/embed', 'inlineWriter')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/write gives the image "!\[\[cat\.png\|300\]\]" back/)
		});
	});

	it('reads inlineWriter as not applicable where there is no write', async () => {
		const plain = inline({
			name: 'plain',
			label: 'Plain',
			prefix: '[[',
			sample: '[[a]]',
			match: /\[\[(\w+)\]\]/,
			read: (m) => m[1],
			as: 'link',
			link: (d) => ({ href: d, text: d, title: null })
		});
		const report = await check(pluginOf('plains', () => [plain]));
		expect(rowOf(report, 'plains/plain', 'inlineWriter')?.status).toBe('not-applicable');
	});

	// The close matches only past an open in the same text, so in its own block it is text.
	it('fails pairSides for a close that reads only beside its open', async () => {
		const leaning = comment({
			sample: '{>>a}text{<<a}',
			close: {
				prefix: '{<<',
				match: (text: string, at: number, end: number) => {
					const found = /^\{<<\w+\}/.exec(text.slice(at, end));
					return found && text.lastIndexOf('{>>', at) >= 0 ? at + found[0].length : -1;
				},
				read: (claim: string) => claim.slice(3, -1)
			}
		});
		const report = await reportOf(check(pluginOf('lean', () => [leaning])));
		expect(rowOf(report, 'lean/cm', 'pairSides')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/"\{<<a\}" alone in a block reads as no close side/)
		});
	});

	it('fails pairSides for a key that reads the two sides differently', async () => {
		const crossed = markerPair<{ id?: string; name?: string }>({
			name: 'cm',
			label: 'Comment',
			open: { prefix: '{>>', match: /\{>>(\w+)\}/, read: (m) => ({ id: m[1] }) },
			close: { prefix: '{<<', match: /\{<<(\w+)\}/, read: (m) => ({ name: m[1] }) },
			key: (data) => String(data.id),
			sample: '{>>a}text{<<a}'
		});
		const report = await reportOf(check(pluginOf('keys', () => [crossed])));
		expect(rowOf(report, 'keys/cm', 'pairSides')?.detail).toMatch(
			/open sides read the keys \["a"\] and the close sides \["undefined"\]/
		);
	});

	it.each<[string, () => unknown[], string, RegExp]>([
		[
			'a construct on another character',
			() => {
				const tag = mention();
				return [tag, formula({ after: tag })];
			},
			'places/formula',
			/names "places\/mention", which starts on another character/
		],
		[
			"the editor's own construct",
			() => [mention({ after: builtin.inlines.link })],
			'places/mention',
			/names the editor's own "link", which every construct is tried before/
		],
		[
			'no mark, for a mark',
			() => {
				const tag = mention();
				return [tag, highlight({ after: tag })];
			},
			'places/hl',
			/names "places\/mention", which is no mark/
		]
	])('fails inlinePlace for an `after` that names %s', async (_name, inlines, subject, message) => {
		const report = await reportOf(check(pluginOf('places', inlines)));
		expect(rowOf(report, subject, 'inlinePlace')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(message)
		});
	});

	it('passes a mark that nests inside the editor’s own mark', async () => {
		const report = await check(
			pluginOf('nests', () => [highlight({ after: builtin.inlines.strong })])
		);
		expect(rowOf(report, 'nests/hl', 'inlinePlace')?.status).toBe('passed');
	});

	it.each([
		['what the block holds', 'passed', (block: { text: string }) => block.text],
		['where the block stands', 'failed', (block: { from: number }) => String(block.from)]
	])('reads dependsContent over a depends that answers %s', async (_name, status, depends) => {
		const report = await reportOf(check(pluginOf('deps', () => [formula({ depends })])));
		expect(rowOf(report, 'deps/formula', 'dependsContent')?.status).toBe(status);
	});

	it("fails editingPolicy for an inner span outside the widget's bytes", async () => {
		const wide = formula({
			widget: { ...DRAWN.widget, inner: (source: string) => ({ start: 1, end: source.length + 4 }) }
		});
		const report = await reportOf(check(pluginOf('wide', () => [wide])));
		expect(rowOf(report, 'wide/formula', 'editingPolicy')?.detail).toMatch(
			/inner\("\$x\$"\) answers .* which isn't inside its bytes/
		);
	});

	// The match takes a byte past the claim, so the slice a copy carries reads as nothing alone.
	it('fails widget for a claim whose bytes read as nothing on their own, and takes an excuse', async () => {
		const peeks = formula({
			sample: 'a $x$! b',
			match: (text: string, at: number, end: number) => {
				const close = text.indexOf('$', at + 1);
				return close > at && text[close + 1] === '!' && close + 1 <= end ? close + 1 : -1;
			},
			read: (claim: string) => claim.slice(1, -1)
		});
		const plugin = pluginOf('peeks', () => [peeks]);
		const report = await reportOf(check(plugin));
		expect(rowOf(report, 'peeks/formula', 'widget')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/re-forms as a whole/)
		});
		const reason = 'the formula is only ever written before an exclamation mark in this product';
		const excused = await check(plugin, { excuse: { inlines: { formula: { widget: reason } } } });
		expect(rowOf(excused, 'peeks/formula', 'widget')?.status).toBe('excused');
	});

	it('refuses an excuse over inlineDecline, which an excuse never covers', async () => {
		const excuse = {
			inlines: { note: { inlineDecline: 'a sentence long enough to count as a reason' } }
		} as unknown as Excuses;
		const report = await reportOf(
			check(
				pluginOf('notes', () => [note]),
				{ excuse }
			)
		);
		expect(rowOf(report, 'notes/note', 'inlineDecline')?.detail).toBe(
			'excused, but an excuse never covers this check'
		);
	});

	it("names an inline row's own contract when it fails", async () => {
		const failure = (await check(
			pluginOf('drifts', () => [mention({ sample: 'no claim here' })])
		).catch((error: unknown) => error)) as Error;
		expect(failure.message).toMatch(
			/inline drifts\/mention claims: .*\n {4}breaks: every sample holds a claim of your construct, starting at its prefix/
		);
	});
});
