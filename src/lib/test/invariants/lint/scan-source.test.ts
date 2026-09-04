/**
 * The scan harness's own coverage guard. Every repo-wide lint inherits its blind spots
 * from `collectEditorSources()`, so a root silently dropping out of the default set
 * narrows a dozen guards at once. A MISSING root throws in `readdirSync`; what needs
 * asserting is the softer regression — a root still present but no longer reached, or a
 * file collected twice because a lint re-adds a root the default already covers.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedCall,
	callArguments,
	collectEditorSources,
	EDITOR_SRC,
	rawAssignments,
	REPO_WIDE_ROOTS,
	stripComments
} from './scan-source';

describe('repo-wide scan roots', () => {
	const sources = collectEditorSources();
	const paths = sources.map((f) => f.relPath);

	it('reaches all three roots, none of them empty', () => {
		const byRoot = {
			library: paths.filter((p) => p.startsWith('src/lib/')),
			referencePlugins: paths.filter((p) => p.startsWith('src/routes/test/plugins/')),
			consumerExample: paths.filter((p) => p.startsWith('examples/consumer/src/'))
		};
		for (const [root, hits] of Object.entries(byRoot)) {
			expect(hits.length, `repo-wide scan reached no file under ${root}`).toBeGreaterThan(0);
		}
		expect(
			byRoot.library.length + byRoot.referencePlugins.length + byRoot.consumerExample.length
		).toBe(paths.length);
	});

	it('sees the reference plugin the external-author rules are modelled on', () => {
		expect(paths).toContain('src/routes/test/plugins/callout/callout-kind.ts');
		// The synced copy under examples/consumer/src/plugins is generated and absent on a
		// fresh checkout; the consumer root is pinned through a tracked file instead.
		expect(paths).toContain('examples/consumer/src/plugin-probe.ts');
	});

	it('collects each file exactly once (no root nested inside another)', () => {
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('an explicit root narrows the scan (the opt-out lints rely on this)', () => {
		const libraryOnly = collectEditorSources(EDITOR_SRC).map((f) => f.relPath);
		expect(libraryOnly.length).toBeLessThan(paths.length);
		expect(libraryOnly.every((p) => p.startsWith('src/lib/'))).toBe(true);
	});

	it('excludes test, e2e, and declaration files from every root', () => {
		// `src/routes/test/plugins` is itself a root, so its own `test` segment is
		// expected; what must not appear is a `test`/`e2e` directory BELOW a root.
		const belowRoot = paths.map((p) => p.replace(/^src\/routes\/test\/plugins\//, ''));
		expect(belowRoot.filter((p) => /(^|\/)(test|e2e)\//.test(p))).toEqual([]);
		expect(paths.filter((p) => p.endsWith('.d.ts'))).toEqual([]);
	});

	it('REPO_WIDE_ROOTS is the declared set the default scan walks', () => {
		expect(REPO_WIDE_ROOTS).toHaveLength(3);
		expect(REPO_WIDE_ROOTS[0]).toBe(EDITOR_SRC);
	});
});

describe('balancedCall', () => {
	// The argument walker under every callsTo-based scan: a `)` inside a string argument
	// truncates the answer, and each of them then reads its slot off a short list.
	it('balances nested parens and skips those inside a string argument', () => {
		const nested = 'splitNode(node, at(i), mode)';
		expect(balancedCall(nested, nested.indexOf('(') + 1)).toBe('node, at(i), mode');

		const quoted = "splitNode(node, ')', mode)";
		expect(balancedCall(quoted, quoted.indexOf('(') + 1)).toBe("node, ')', mode");
	});
});

// Miss-analysis: the walkers' own cases fed them strings and nested parens, never a regex
// literal, so the quote tracking's blindness to one was pinned as a fallback instead of caught.
describe('literal-aware walking', () => {
	it('balances a call whose argument holds a regex literal', () => {
		const regexArg = 'encode(title.replace(/"/g, "x"))';
		expect(balancedCall(regexArg, regexArg.indexOf('(') + 1)).toBe('title.replace(/"/g, "x")');

		// A string-blind read answers `a, '` here: it counts the paren inside the string literal.
		const both = "foo(a, ')', /'/.test(b))";
		expect(balancedCall(both, both.indexOf('(') + 1)).toBe("a, ')', /'/.test(b)");
	});

	it('splits top-level arguments around a regex literal, character class included', () => {
		expect(callArguments("a, /'/.test(x), b")).toEqual(['a', "/'/.test(x)", 'b']);
		expect(callArguments('a, /[/,]/.test(x), b')).toEqual(['a', '/[/,]/.test(x)', 'b']);
		expect(callArguments('a, /\\//.test(x), b')).toEqual(['a', '/\\//.test(x)', 'b']);
	});

	// The other half of the recognizer: reading division as a regex swallows the operands
	// between two slashes, which merges argument slots just as silently.
	it('reads division as division', () => {
		expect(callArguments("f(x) / g(y), 'a, b', c")).toEqual(['f(x) / g(y)', "'a, b'", 'c']);
		expect(callArguments('a, b / c, d')).toEqual(['a', 'b / c', 'd']);
	});

	// Every scan reads slots by position off the stripped text, so a strip that changes length
	// slides every downstream offset.
	it('strips comments without moving a single offset', () => {
		const cases = [
			"const url = 'https://x'; // trailing\nnext();",
			'/* unterminated block comment',
			'const re = /\\/\\//; /* mid */ call();',
			'const t = `a ${b /* c */} d`;'
		];
		for (const text of cases) expect(stripComments(text)).toHaveLength(text.length);
		expect(stripComments("const url = 'https://x'; // trailing")).toBe(
			"const url = 'https://x';            "
		);

		// A comment inside a `${…}` interpolation is a comment: interpolations are code.
		expect(stripComments('const t = `a ${b /* c */} d`;')).toBe(
			'const t = `a ${b ' + ' '.repeat(7) + '} d`;'
		);
	});

	// Miss-analysis: every strip case was TypeScript source, so no fixture ever put a token inside
	// a `.svelte` markup comment — the one comment form the blanking did not know.
	it('blanks a markup comment, so a census cannot count the site inside one', () => {
		const markup = '<!-- <BlockHost path={[]} /> -->\n<BlockHost path={[]} />';
		const code = stripComments(markup);
		expect(code).toHaveLength(markup.length);
		expect([...code.matchAll(/<BlockHost/g)]).toHaveLength(1);

		// A `<!--` the source quotes is text: the walk steps over the string whole.
		expect(stripComments("const open = '<!--'; call();")).toBe("const open = '<!--'; call();");
	});

	// A `/` after `}` is Svelte markup (`{a}/{b}`), never a regex opening: reading one as a regex
	// swallows every byte to the next slash — here, the comment that must still blank.
	it('reads a slash after a closing brace as code, not a regex opening', () => {
		expect(stripComments('{a}/{b /* c */}</span>')).toBe('{a}/{b ' + ' '.repeat(7) + '}</span>');
		expect(stripComments('{a} / {b /* c */}')).toBe('{a} / {b ' + ' '.repeat(7) + '}');
	});

	it('terminates a raw-write statement at the semicolon past a regex literal', () => {
		const src = "node.raw = source.replace(/'/g, '') + ending;\nconst other = 1;";
		expect(rawAssignments([{ relPath: 'x', text: src, code: src }])).toEqual([
			{ relPath: 'x', statement: ".raw = source.replace(/'/g, '') + ending" }
		]);
	});
});
