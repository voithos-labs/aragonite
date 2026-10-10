/**
 * The source-scan lexer, held against TypeScript's (G4.57). Every census reads code through
 * `spanAt`, so a literal it misreads shrinks a dozen populations at once with nothing failing.
 * Both classify each character of every scanned `.ts` file and `.svelte` script block and must
 * agree; TypeScript cannot lex markup or stylesheets, so those are pinned to a corpus instead.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { parse, type AST } from 'svelte/compiler';
import {
	collectEditorSources,
	languageOf,
	lexicalClasses,
	LEXICAL_CLASSES,
	ROUTES_SRC,
	type SourceFile,
	type SourceLanguage
} from './scan-source';

const classOf = (name: (typeof LEXICAL_CLASSES)[number]): number => LEXICAL_CLASSES.indexOf(name);

// ── The TypeScript reference ─────────────────────────────────────────────────

const TOKEN_CLASS = new Map<ts.SyntaxKind, number>([
	[ts.SyntaxKind.SingleLineCommentTrivia, classOf('comment')],
	[ts.SyntaxKind.MultiLineCommentTrivia, classOf('comment')],
	[ts.SyntaxKind.ShebangTrivia, classOf('comment')],
	[ts.SyntaxKind.StringLiteral, classOf('string')],
	[ts.SyntaxKind.NoSubstitutionTemplateLiteral, classOf('template')],
	[ts.SyntaxKind.TemplateHead, classOf('template')],
	[ts.SyntaxKind.TemplateMiddle, classOf('template')],
	[ts.SyntaxKind.TemplateTail, classOf('template')],
	[ts.SyntaxKind.RegularExpressionLiteral, classOf('regex')]
]);

/** A `/` opens a regex, and a `}` resumes a template, only where the parser says so; the bare
 *  scanner lexes a regex body as tokens and finds comments inside it. */
function rescanPoints(sourceFile: ts.SourceFile): { regex: Set<number>; template: Set<number> } {
	const regex = new Set<number>();
	const template = new Set<number>();
	const visit = (node: ts.Node): void => {
		if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
			regex.add(node.getStart(sourceFile));
		} else if (
			node.kind === ts.SyntaxKind.TemplateMiddle ||
			node.kind === ts.SyntaxKind.TemplateTail
		) {
			template.add(node.getStart(sourceFile));
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);
	return { regex, template };
}

function typescriptClasses(text: string, fileName: string): Uint8Array {
	const out = new Uint8Array(text.length);
	const points = rescanPoints(
		ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
	);
	const scanner = ts.createScanner(
		ts.ScriptTarget.Latest,
		false,
		ts.LanguageVariant.Standard,
		text
	);
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		const start = scanner.getTokenStart();
		const isSlash = token === ts.SyntaxKind.SlashToken || token === ts.SyntaxKind.SlashEqualsToken;
		if (isSlash && points.regex.has(start)) token = scanner.reScanSlashToken();
		else if (token === ts.SyntaxKind.CloseBraceToken && points.template.has(start)) {
			token = scanner.reScanTemplateToken(false);
		}
		const cls = TOKEN_CLASS.get(token);
		if (cls !== undefined) out.fill(cls, start, scanner.getTokenEnd());
	}
	return out;
}

// ── Svelte scripts ───────────────────────────────────────────────────────────

/** Svelte types a script body as an estree `Program`, which drops the offsets its parse sets. */
function bodyRange(block: AST.Script): [number, number] {
	const { start, end } = block.content as unknown as { start: number; end: number };
	return [start, end];
}

/** The `<script>` bodies, the only part of a `.svelte` file TypeScript can lex. */
function scriptRanges(text: string): Array<[number, number]> {
	const ast = parse(text, { modern: true });
	return [ast.module, ast.instance]
		.flatMap((block) => (block ? [bodyRange(block)] : []))
		.sort((a, b) => a[0] - b[0]);
}

/** Markup blanked rather than cut out, so a script offset stays where the hand lexer read it. */
function maskOutsideScripts(text: string, ranges: Array<[number, number]>): string {
	const chars: string[] = Array.from(text, (ch) => (ch === '\n' ? '\n' : ' '));
	for (const [from, to] of ranges) for (let i = from; i < to; i++) chars[i] = text[i];
	return chars.join('');
}

// ── The differential ─────────────────────────────────────────────────────────

function lineColumn(text: string, index: number): string {
	const before = text.slice(0, index);
	return `${before.split('\n').length}:${index - before.lastIndexOf('\n')}`;
}

/** The first character the two lexers read differently, rendered so a red diagnoses itself. */
function firstDivergence(
	file: SourceFile,
	hand: Uint8Array,
	oracle: Uint8Array,
	ranges: Array<[number, number]>
): string | null {
	for (const [from, to] of ranges) {
		for (let i = from; i < to; i++) {
			if (hand[i] === oracle[i]) continue;
			const around = file.text.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, '\\n');
			const read = `hand=${LEXICAL_CLASSES[hand[i]]} ts=${LEXICAL_CLASSES[oracle[i]]}`;
			return `${file.relPath}:${lineColumn(file.text, i)} ${read} in ${around}`;
		}
	}
	return null;
}

function divergenceIn(file: SourceFile, hand: Uint8Array): string | null {
	if (!file.relPath.endsWith('.svelte')) {
		const oracle = typescriptClasses(file.text, file.relPath);
		return firstDivergence(file, hand, oracle, [[0, file.text.length]]);
	}
	const ranges = scriptRanges(file.text);
	if (ranges.length === 0) return null;
	const masked = maskOutsideScripts(file.text, ranges);
	return firstDivergence(file, hand, typescriptClasses(masked, file.relPath), ranges);
}

// ── The markup half ──────────────────────────────────────────────────────────

/** One letter per class, so a pinned reading sits under its own source. */
const CLASS_LETTERS = '.cstr';

function classLine(source: string, language: SourceLanguage = 'script'): string {
	return Array.from(lexicalClasses(source, language), (cls) => CLASS_LETTERS[cls]).join('');
}

/** Component shapes TypeScript cannot lex: markup is text but for comments, attribute values
 *  and braces, and a style body is a stylesheet. */
const MARKUP_CORPUS: Array<[source: string, classes: string]> = [
	['{a}/{b /* c */}', '.......ccccccc.'],
	['<Foo {...rest} /><Bar {...rest} />', '.'.repeat(34)],
	['<a href="https://x">', '........sssssssssss.'],
	['{#if /^a$/.test(v)}', '.....rrrrr.........'],
	['<b class="a-{f(x)}">', '.........ssss....ss.'],
	["<p>Sam's list</p>", '.'.repeat(17)],
	['<p>see https://x /* y</p>', '.'.repeat(25)],
	['<!-- x -->', 'cccccccccc'],
	['<style>a{b:url(//x)}</style>', '.'.repeat(28)],
	["<script>'//'</script>", '........ssss.........'],
	// Miss-analysis: Prettier puts every block closer on its own line, so no scanned file showed
	// a closer with a slash after it reading as a regex.
	['{#if a}x{/if}</p><p>//x</p>', '.'.repeat(27)],
	['{#each xs as x}x{ /each }</ul><p>//x</p>', '.'.repeat(40)],
	['{#await p}x{:then v}y{:catch e}z{/await}//x', '.'.repeat(43)],
	['{/* c */ x}', '.ccccccc...'],
	// Miss-analysis: every closer row sat between tags, so nothing showed a tag's own `{/re/…}`
	// value read as a closer.
	['<a class={/x/.test(y) /* c */}>', '..........rrr.........ccccccc..'],
	["<a class={/x/.test(y) ? 'grid' : ''}>", '..........rrr...........ssssss...ss..'],
	['{#if a}x{/if\n<!-- c -->', `${'.'.repeat(13)}${'c'.repeat(10)}`]
];

/** A stylesheet has quoted strings and block comments, and no line comments. */
const STYLESHEET_CORPUS: Array<[source: string, classes: string]> = [
	['a{b:url(//x)}', '.'.repeat(13)],
	["/* c */a{b:'//'}", 'ccccccc....ssss.']
];

/** A slash after each operator opens a regex, the one after a postfix `++` or `--` divides. The
 *  regex holds a `(` so a misread also unbalances a bracket walk. */
const BINARY = '+ - * ** % & | ^ << >> >>> && || ?? == != === !== <= >= = += **= >>>= &&= ??=';
const SLASH_AFTER_OPERATOR: Array<[op: string, source: string, opensRegex: boolean]> = [
	...BINARY.split(' ').map((op): [string, string, boolean] => [op, `x ${op} /[(]/.exec(s);`, true]),
	...['~', '!', '+', '-'].map((op): [string, string, boolean] => [
		`unary ${op}`,
		`x = ${op}/[(]/.exec(s);`,
		true
	]),
	['postfix ++', 'x = i++ / 2 / 3;', false],
	['postfix --', 'x = i-- / 2 / 3;', false]
];

describe('G4.57 the scan lexer reads what TypeScript reads', () => {
	// The comment and wall-clock lints also lex the test tree and `src/routes` (G4.26, G4.48), so
	// the differential runs over that wider corpus, deduped since two roots share a folder.
	const corpus = new Map<string, SourceFile>();
	for (const file of [
		...collectEditorSources(undefined, { includeTests: true }),
		...collectEditorSources(ROUTES_SRC, { includeTests: true })
	]) {
		corpus.set(file.relPath, file);
	}
	const outside = collectEditorSources()
		.map((file) => file.relPath)
		.filter((relPath) => !corpus.has(relPath));

	// Lexed at collection, which no test timeout bounds: the corpus takes seconds on a busy machine.
	const seen = new Set<number>();
	const found: string[] = [];
	for (const file of corpus.values()) {
		const hand = lexicalClasses(file.text, languageOf(file.relPath));
		for (const cls of hand) seen.add(cls);
		const report = divergenceIn(file, hand);
		if (report !== null) found.push(report);
	}

	it('lexed every editor source, tests and routes besides, with every class represented', () => {
		expect(outside, 'editor sources the wider corpus misses').toEqual([]);
		expect([...seen].sort((a, b) => a - b)).toEqual(LEXICAL_CLASSES.map((_, index) => index));
	});

	it('every character of the census corpus lexes the same as TypeScript reads it', () => {
		expect(
			found,
			'fix the lexer in scan-source.ts, or pin the shape here with the reason no census can move'
		).toEqual([]);
	});

	it('markup and stylesheet shapes TypeScript cannot lex keep their class', () => {
		for (const [source, classes] of MARKUP_CORPUS) {
			expect(classLine(source, 'component'), source).toBe(classes);
		}
		for (const [source, classes] of STYLESHEET_CORPUS) {
			expect(classLine(source, 'stylesheet'), source).toBe(classes);
		}
	});

	// Miss-analysis: no scanned file puts a regex after an arithmetic, bitwise or `??` operator.
	it.each(SLASH_AFTER_OPERATOR)(
		'a slash after %s lexes as TypeScript reads it',
		(_op, source, opensRegex) => {
			const oracle = typescriptClasses(source, 'probe.ts');
			expect(oracle.includes(classOf('regex')), source).toBe(opensRegex);
			expect(classLine(source)).toBe(Array.from(oracle, (cls) => CLASS_LETTERS[cls]).join(''));
		}
	);

	// ── Reference self-tests (non-vacuity) ───────────────────────────────────

	const PROBE =
		'const half = total / 2;\nconst re = /\'"/.test(s); // done\nconst t = `a ${b /* c */} d`;';

	it('the check tells a division from a regex and reads inside both', () => {
		const classes = typescriptClasses(PROBE, 'probe.ts');
		const classAt = (needle: string): string => LEXICAL_CLASSES[classes[PROBE.indexOf(needle)]];
		expect(classAt('/ 2')).toBe('code');
		expect(classAt('\'"')).toBe('regex');
		expect(classAt('// done')).toBe('comment');
		expect(classAt('a ${')).toBe('template');
		expect(classAt('b /*')).toBe('code');
		expect(classAt('/* c */')).toBe('comment');
	});

	it('the report names the first divergent character', () => {
		const file: SourceFile = { relPath: 'p.ts', text: 'a\nconst x = 1;', code: '' };
		const hand = lexicalClasses(file.text, languageOf(file.relPath));
		const oracle = hand.slice();
		oracle[7] = classOf('string');
		expect(firstDivergence(file, hand, oracle, [[0, file.text.length]])).toContain(
			'p.ts:2:6 hand=code ts=string'
		);
	});
});
