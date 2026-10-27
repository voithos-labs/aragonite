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
import type { InlineConformanceProfile } from '#lib/testing.js';
import { emojiPlugin, EMOJI_KIND } from '#lib/plugins/emoji/index.js';
import { footnotesPlugin, FOOTNOTE_REF_KIND } from '#lib/plugins/footnotes/index.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { MATH_INLINE } from '#lib/plugins/latex/latex-kind.js';
import { testDirectiveViews } from '#lib/test/harness/test-view.js';

const MINTS_ONLY_ITS_OWN_KIND =
	'the rung mints only its own inline kind, which the scan leaves unstamped by design — ' +
	'nothing outside the plugin has a grammar to re-serialize it with';

const footnoteRung: InlineConformanceProfile = {
	trigger: '[',
	prefix: '[^',
	get kind() {
		return declaredPluginInlineKind(FOOTNOTE_REF_KIND);
	},
	fixtures: ['[^note]', 'see [^a] and [^b]'],
	// `[` is the built-in link and reference handler's own trigger, and the `[^` handler is
	// asked ahead of it: every malformed reference has to fall through with its bytes intact.
	overlapFixtures: ['[^]', '[^ spaced]', '[^unterminated', 'a [link [^ ] here](https://x.dev)'],
	overlapDecline: { mode: 'assert' },
	widget: { mode: 'assert' },
	editingPolicy: { mode: 'assert' },
	imageClaim: { mode: 'exempt', reason: MINTS_ONLY_ITS_OWN_KIND }
};

const emojiRung: InlineConformanceProfile = {
	trigger: ':',
	priority: INLINE_PRIORITIES.plugin + 10,
	get kind() {
		return declaredPluginInlineKind(EMOJI_KIND);
	},
	fixtures: [':smile:', 'ship it :rocket: now'],
	// `:` is shared with the directive text handler one priority below, and with prose that
	// merely contains a colon; every one of these must arrive intact.
	overlapFixtures: [
		':name[label]',
		':name{.cls}',
		'meet at 10:30',
		'see https://x.dev',
		':notaname:'
	],
	overlapDecline: { mode: 'assert' },
	widget: { mode: 'assert' },
	editingPolicy: { mode: 'assert' },
	imageClaim: { mode: 'exempt', reason: MINTS_ONLY_ITS_OWN_KIND }
};

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

const mathRung: InlineConformanceProfile = {
	trigger: '$',
	get kind() {
		return declaredPluginInlineKind(MATH_INLINE);
	},
	fixtures: ['$x^2$', 'let $a+b$ be', 'one part in $10^5$'],
	// Shell and currency prose is the whole reason a `$` match is guarded at all; one taken
	// here would eat a paragraph's worth of bytes.
	overlapFixtures: ['$5 and $10', '$ x $', '$HOME and $PATH', 'costs $9', 'between $10-$20'],
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
