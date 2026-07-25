import fc from 'fast-check';
import { arbInlineSource } from './inline';
import { arbGfmDoc } from './gfm';

/**
 * Source fragments for the grammars the bundled plugins add. No built-in
 * arbitrary can emit any of them, so every rung shipped as a plugin — the
 * newest and least-audited scanner and opener code — sat outside the property
 * suites entirely and was covered by hand-written per-kind fixtures only.
 *
 * These are SOURCE strings; the suites that draw them install the matching
 * plugins first. Drawn without a plugin installed they are still valid input —
 * the text simply parses as prose, which is itself the coexistence case.
 */

// ── Inline rungs ─────────────────────────────────────────────────────────────

/**
 * Tokens that reach each rung's claim AND its decline: a bare `[^` and a lone
 * `:` exercise the prefix-match and bare-trigger paths that a well-formed token
 * never does, and those declines are where a rung perturbs a neighbour's scan.
 */
const inlineRungToken = fc.constantFrom(
	'[^1]',
	'[^note]',
	'[^',
	'[^]',
	':smile:',
	':+1:',
	':',
	'::',
	':not-an-emoji:',
	'$x$',
	'$a_b$',
	'$',
	'$$',
	'~sub~',
	'~~strike~~'
);

/** Plugin tokens interleaved with adversarial built-in inline content. */
export const arbPluginInlineSource = fc
	.array(
		fc.oneof({ arbitrary: arbInlineSource, weight: 2 }, { arbitrary: inlineRungToken, weight: 3 }),
		{
			minLength: 1,
			maxLength: 6
		}
	)
	.map((parts) => parts.join(''));

// ── Block openers ────────────────────────────────────────────────────────────

const footnoteDefinition = fc
	.tuple(fc.constantFrom('1', 'note', 'a b'), fc.constantFrom('text', 'more words', ''))
	.map(([label, body]) => `[^${label}]: ${body}\n`);

const mathFence = fc
	.tuple(
		fc.constantFrom('$$', '$$math'),
		fc.array(fc.constantFrom('x = 1', '\\frac{a}{b}', ''), { maxLength: 3 })
	)
	.map(([open, body]) => open + '\n' + body.map((l) => l + '\n').join('') + '$$\n');

const githubAlert = fc
	.tuple(
		fc.constantFrom('NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'BOGUS'),
		fc.array(fc.constantFrom('body', 'more', ''), { maxLength: 2 })
	)
	.map(
		([type, body]) => `> [!${type}]\n` + body.map((l) => (l === '' ? '>\n' : `> ${l}\n`)).join('')
	);

const directive = fc
	.tuple(
		fc.constantFrom(':::', '::::'),
		fc.constantFrom('note', 'callout', 'unknown-name', ''),
		fc.array(fc.constantFrom('inner', '', '# heading'), { maxLength: 2 })
	)
	.map(
		([fence, name, body]) => fence + name + '\n' + body.map((l) => l + '\n').join('') + fence + '\n'
	);

/**
 * A GFM document with plugin block syntax mixed in. The unterminated and
 * malformed arms (`$$` with no closer, `[!BOGUS]`, a nameless `:::`) matter as
 * much as the well-formed ones: an opener that mis-declines still has to leave
 * the bytes it refused untouched.
 */
export const arbPluginGfmDoc = fc
	.array(
		fc.oneof(
			{ arbitrary: arbGfmDoc, weight: 2 },
			{ arbitrary: footnoteDefinition, weight: 2 },
			{ arbitrary: mathFence, weight: 1 },
			{ arbitrary: githubAlert, weight: 2 },
			{ arbitrary: directive, weight: 2 },
			{ arbitrary: arbPluginInlineSource.map((s) => s + '\n'), weight: 2 }
		),
		{ minLength: 1, maxLength: 6 }
	)
	.map((blocks) => blocks.join(''));
