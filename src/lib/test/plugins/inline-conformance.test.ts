// @vitest-environment jsdom
/**
 * Enrollment: every bundled inline rung runs the published conformance kit. A rung
 * shipping in this repo is the kit's first consumer, so a cell no bundled rung can
 * pass is a cell that has not been paid for.
 *
 * The kit's own red demonstrations live in `inline-conformance-red.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '$lib';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_TEXT } from '$lib/core/directive/kinds';
import { INLINE_PRIORITIES } from '$lib/core/inline/scan/plugin-syntax';
import { declaredPluginInlineKind } from '$lib/plugin';
import { resetPluginPlatformForTests, runInlineKindConformance } from '$lib/testing';
import type { InlineConformanceProfile } from '$lib/testing';
import { emojiPlugin, EMOJI_KIND } from '$lib/plugins/emoji';
import { footnotesPlugin, FOOTNOTE_REF_KIND } from '$lib/plugins/footnotes';
import { latexPlugin } from '$lib/plugins/latex';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

// The renderer is a required option and the kit never renders math, so a no-op
// stub satisfies it without pulling a math engine into the suite.
const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

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
	// `[` is the built-in link/reference handler's own trigger, and the `[^` rung is
	// consulted ahead of it: every malformed reference has to fall through byte-clean.
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
	// `:` is shared with the directive text tier one rung below, and with prose that
	// merely contains a colon — every one of these must reach the next reader intact.
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
	fixtures: ['$x^2$', 'let $a+b$ be'],
	// Shell and currency prose is the whole reason the opener is digit- and
	// whitespace-guarded; a claim here would eat a paragraph's worth of bytes.
	overlapFixtures: ['$5 and $10', '$ x $', '$HOME and $PATH', 'costs $9'],
	overlapDecline: { mode: 'assert' },
	widget: { mode: 'assert' },
	editingPolicy: { mode: 'assert' },
	imageClaim: { mode: 'exempt', reason: MINTS_ONLY_ITS_OWN_KIND }
};

describe('every bundled inline rung passes the conformance kit', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		// Emoji BEFORE the directive activation on purpose: that order is what leaves the
		// tier's recognizer unregistered, making its `registration` cell a live guard.
		installPlugins([emojiPlugin(), footnotesPlugin(), latexPlugin({ renderer: stubRenderer })]);
		activateDirectiveGrammar();
	});

	it.each([
		['footnote reference', footnoteRung],
		['emoji', emojiRung],
		['directive text', directiveTextRung],
		['inline math', mathRung]
	])('%s', (_name, profile) => {
		const report = runInlineKindConformance(profile);
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

// A cell recorded rather than executed proves nothing: a fixture that stopped being
// claimed, or a jsdom-less run, would otherwise pass as a quiet `boundary`.
describe('the enrolled rungs execute the cells their shape owns', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([emojiPlugin(), footnotesPlugin(), latexPlugin({ renderer: stubRenderer })]);
		activateDirectiveGrammar();
	});

	const cellOf = (profile: InlineConformanceProfile, cell: string) =>
		runInlineKindConformance(profile).cells.find((c) => c.cell === cell)!;

	it('drives the offset walk for a rung that builds its own island', () => {
		const cell = cellOf(emojiRung, 'widget');
		expect(cell.status).toBe('asserted');
		expect(cell.detail).toContain('offset-walk length');
	});

	// The island of a `component` kind is the editor's, so that half does not run and
	// the cell must SAY so — `asserted` over skipped work is the silent skip.
	it('reports the island half of a `component` widget as a boundary', () => {
		const cell = cellOf(footnoteRung, 'widget');
		expect(cell.status).toBe('boundary');
		expect(cell.detail).toContain('render layer');
	});

	it('checks the whole-delete bytes for an atomic-delete rung', () => {
		expect(cellOf(emojiRung, 'editingPolicy').detail).toContain('whole-delete');
	});

	it('excuses imageClaim only where no fixture mints a built-in', () => {
		expect(cellOf(mathRung, 'imageClaim').status).toBe('exempt');
	});
});
