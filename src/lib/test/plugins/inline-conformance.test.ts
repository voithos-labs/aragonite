// @vitest-environment jsdom
// Every bundled inline handler runs the published conformance kit as its first consumer, so a
// cell no bundled handler can pass has not earned its runtime. The kit's failing cases live in
// `inline-conformance-red.test.ts`.

import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '#lib';
import { activateDirectiveGrammar } from '#lib/core/directive/activate.js';
import { DIRECTIVE_TEXT } from '#lib/core/directive/kinds.js';
import { INLINE_PRIORITIES } from '#lib/plugin.js';
import { declaredPluginInlineKind } from '#lib/plugin.js';
import { runInlineKindConformance } from '#lib/testing.js';
import type { InlineConformanceProfile, PluginConformanceSuite } from '#lib/testing.js';
import { emojiPlugin } from '#packages/emoji/src/index.js';
import emojiSuite from '#packages/emoji/src/conformance.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import footnotesSuite from '#packages/footnotes/src/conformance.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import latexSuite from '#packages/latex/src/conformance.js';
import { testDirectiveViews } from '#lib/test/harness/test-view.js';

const MINTS_ONLY_ITS_OWN_KIND =
	'the rung mints only its own inline kind, which the scan leaves unstamped by design — ' +
	'nothing outside the plugin has a grammar to re-serialize it with';

/** A package's published inline profile, its kind read once the plugin has declared it. */
function publishedRung(suite: PluginConformanceSuite): InlineConformanceProfile {
	const { kind, ...profile } = suite.inline![0];
	return {
		...profile,
		get kind() {
			return declaredPluginInlineKind(kind!);
		}
	};
}

const footnoteRung = publishedRung(footnotesSuite);
const emojiRung = publishedRung(emojiSuite);
const mathRung = publishedRung(latexSuite);

const directiveTextRung: InlineConformanceProfile = {
	trigger: ':',
	priority: INLINE_PRIORITIES.plugin,
	get kind() {
		return declaredPluginInlineKind(DIRECTIVE_TEXT);
	},
	fixtures: [':name[label]', ':name{.cls}', 'a :name[label]{.cls} b'],
	overlapFixtures: [':smile:', 'meet at 10:30', 'see https://x.dev', ':bare'],
	overlapDecline: { mode: 'assert' },
	widget: { mode: 'assert' },
	editingPolicy: { mode: 'assert' },
	imageClaim: { mode: 'exempt', reason: MINTS_ONLY_ITS_OWN_KIND }
};

describe('every bundled inline syntax handler passes the conformance kit', () => {
	beforeEach(() => {
		// Emoji before the directive activation on purpose: that order is what leaves the
		// directive recognizer unregistered, making its `registration` cell a live check.
		installPlugins([emojiPlugin(), footnotesPlugin(), latexPlugin()]);
		activateDirectiveGrammar(testDirectiveViews());
	});

	it.each([
		['footnote reference', footnoteRung],
		['emoji', emojiRung],
		['directive text', directiveTextRung],
		['inline math', mathRung]
	])('%s', async (_name, profile) => {
		const report = await runInlineKindConformance(profile);
		expect(report.cells.map((c) => c.cell)).toEqual([
			'claims',
			'roundTrip',
			'overlapDecline',
			'widget',
			'editingPolicy',
			'imageClaim',
			'registration'
		]);
	});
});

// A cell recorded rather than executed proves nothing: a fixture that stopped matching would
// otherwise pass as a quiet `boundary`.
describe('the enrolled inline syntax handlers execute the cells their shape owns', () => {
	beforeEach(() => {
		installPlugins([emojiPlugin(), footnotesPlugin(), latexPlugin()]);
		activateDirectiveGrammar(testDirectiveViews());
	});

	const cellOf = async (profile: InlineConformanceProfile, cell: string) =>
		(await runInlineKindConformance(profile)).cells.find((c) => c.cell === cell)!;

	// The shell is the editor's, so the cell asserts every widget kind the same way, a plain DOM
	// view (emoji) and a Svelte one (footnotes) alike.
	it.each([
		['a DOM view', emojiRung],
		['a Svelte view', footnoteRung]
	])('asserts the widget cell for %s', async (_view, rung) => {
		const cell = await cellOf(rung, 'widget');
		expect(cell.status).toBe('asserted');
		expect(cell.detail).toContain('self-delimiting');
	});

	it('checks the whole-delete bytes for an atomic-delete inline syntax handler', async () => {
		expect((await cellOf(emojiRung, 'editingPolicy')).detail).toContain('whole-delete');
	});

	it('excuses imageClaim only where no fixture creates a built-in', async () => {
		expect((await cellOf(mathRung, 'imageClaim')).status).toBe('exempt');
	});
});
