// @vitest-environment jsdom
// The conformance kit over the inline syntax handlers the process-wide registrars still take: the
// directive text, the footnote reference as it was registered before it became a plugin value (a
// Svelte view), and a local glyph (a plain DOM view, a whole delete). The kit's failing cases live
// in `inline-conformance-red.test.ts`.

import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '#lib';
import { activateDirectiveGrammar } from '#lib/core/directive/activate.js';
import { DIRECTIVE_TEXT } from '#lib/core/directive/kinds.js';
import { INLINE_PRIORITIES } from '#lib/plugin.js';
import { declaredPluginInlineKind } from '#lib/plugin.js';
import { runInlineKindConformance } from '#lib/testing.js';
import type { InlineConformanceProfile } from '#lib/testing.js';
import { FOOTNOTE_REF_KIND, registeredFootnotes } from '#lib/test/harness/registered-footnotes.js';
import { testDirectiveViews } from '#lib/test/harness/test-view.js';
import { GLYPH_KIND, GLYPH_PRIORITY, glyphPlugin } from '#lib/test/harness/glyph-plugin.js';

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
	// `[` is the link handler's own trigger, so every malformed reference falls through intact.
	overlapFixtures: ['[^]', '[^ spaced]', '[^unterminated', 'a [link [^ ] here](https://x.dev)'],
	overlapDecline: { mode: 'assert' },
	widget: { mode: 'assert' },
	editingPolicy: { mode: 'assert' },
	imageClaim: { mode: 'exempt', reason: 'the recognizer builds only its own inline kind' }
};

/** A widget drawn as plain DOM and deleted whole, which no bundled inline syntax handler is. */
const glyphRung: InlineConformanceProfile = {
	trigger: ':',
	priority: GLYPH_PRIORITY,
	get kind() {
		return declaredPluginInlineKind(GLYPH_KIND);
	},
	fixtures: [':smile:', 'ship it :rocket: now'],
	overlapFixtures: [':name[label]', ':name{.cls}', 'meet at 10:30', 'see https://x.dev', ':bare:'],
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

describe('every bundled inline syntax handler passes the conformance kit', () => {
	beforeEach(() => {
		// A `:` handler before the directive activation on purpose: that order is what leaves the
		// directive recognizer unregistered, making its `registration` cell a live check.
		installPlugins([glyphPlugin(), registeredFootnotes()]);
		activateDirectiveGrammar(testDirectiveViews());
	});

	it.each([
		['footnote reference', footnoteRung],
		['directive text', directiveTextRung]
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
		installPlugins([glyphPlugin(), registeredFootnotes()]);
		activateDirectiveGrammar(testDirectiveViews());
	});

	const cellOf = async (profile: InlineConformanceProfile, cell: string) =>
		(await runInlineKindConformance(profile)).cells.find((c) => c.cell === cell)!;

	// The shell is the editor's, so the cell asserts every widget kind the same way, a plain DOM
	// view (the glyph) and a Svelte one (footnotes) alike.
	it.each([
		['a DOM view', glyphRung],
		['a Svelte view', footnoteRung]
	])('asserts the widget cell for %s', async (_view, rung) => {
		const cell = await cellOf(rung, 'widget');
		expect(cell.status).toBe('asserted');
		expect(cell.detail).toContain('self-delimiting');
	});

	it('checks the whole-delete bytes for an atomic-delete inline syntax handler', async () => {
		expect((await cellOf(glyphRung, 'editingPolicy')).detail).toContain('whole-delete');
	});

	it('excuses imageClaim only where no fixture creates a built-in', async () => {
		expect((await cellOf(directiveTextRung, 'imageClaim')).status).toBe('exempt');
	});
});
