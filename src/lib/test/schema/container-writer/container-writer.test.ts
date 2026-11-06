// The container writer against today's per-kind writers, over named documents for tab columns,
// lazy lines and the container facts, and the law harness's and respelled containers' draws.
// `CONTAINER_WRITER_DIFF=full` adds the behavior corpus and the spec's examples, with more draws.
import { beforeEach, describe, expect, it } from 'vitest';
import { devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { perfEnabled } from '#lib/perf/instruments.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { COLON_LINES } from '#lib/schema/colon-lines.js';
import { QUOTE_LINES } from '#lib/core/parsers/blockquote.js';
import { LIST_ITEM_LINES } from '#lib/core/parsers/list.js';
import type { AnyBlockKind, CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { createEditorGrammar, defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { tocPlugin } from '#packages/toc/src/index.js';
import {
	differentialDocuments,
	rowsOf,
	runDifferential,
	type Mismatch,
	type Writer
} from './differential';
import { todayWriter } from './today-writers';

const shaped: Writer = (node: CstNode, changed) =>
	writeContainerRaw(node, defaultGrammarView, changed);

beforeEach(() => {
	installPlugins([admonitionsPlugin(), detailsPlugin(), footnotesPlugin()]);
});

describe('the container writer against today’s writers', () => {
	it('gives the same bytes and asks for the same rereads', () => {
		// A region splice compares itself with a full rebuild only under the dev checks.
		expect([devChecksOn, perfEnabled()]).toEqual([true, false]);
		const scale = process.env.CONTAINER_WRITER_DIFF === 'full' ? 'full' : 'quick';
		const tally = runDifferential(differentialDocuments(scale, 20261106), todayWriter, shaped);
		expect(tally.cases).toBeGreaterThan(scale === 'full' ? 100_000 : 1_000);
		expect(tally.throws).toEqual([]);
		expect(tally.warns).toEqual({});
		expect(tally.mismatches.filter((m) => !ruled(m)).slice(0, 3)).toEqual([]);
		// Both ruled changes show up in the run, so the filter above can't hide a quiet writer.
		expect(new Set(tally.mismatches.map((m) => m.kind))).toEqual(
			new Set(['blockquote', 'githubAlert'])
		);
	}, 600_000);
});

/** The two ruled changes from the writers before: a quote line emptied of its text keeps its
 *  marker as spelled, and an alert's head line keeps its spelling while it writes the same type. */
function ruled({ kind, before, today, shaped, rereads }: Mismatch): boolean {
	if (rereads[0] !== rereads[1] || (kind !== 'blockquote' && kind !== 'githubAlert')) return false;
	const [was, old, now] = [before, today, shaped].map((raw) => raw.split('\n'));
	const markerOnly = (line: string) => /^[ \t>]*\r?$/.test(line);
	const markers = (line: string) => line.replace(/[ \t\r]/g, '');
	return (
		old.length === now.length &&
		old.every(
			(line, i) =>
				line === now[i] ||
				(markerOnly(line) && markerOnly(now[i]) && markers(line) === markers(now[i])) ||
				(kind === 'githubAlert' && i === 0 && now[0] === was[0])
		)
	);
}

// Today's bytes after one edit, which the container writer gives too. A row whose bytes disagree
// with the container facts says so in its name.
const NAMED_ROWS: [name: string, source: string, edit: string, kind: string, bytes: string][] = [
	[
		'tab after > kept on a changed line',
		'>\tfoo\n>\tbar\n',
		'x on line 0 child 0',
		'blockquote',
		'>\tfoox\n>\tbar\n'
	],
	[
		'two tabs after > read as bytes, not columns',
		'>\t\tfoo\n',
		'line added child 0',
		'blockquote',
		'>\t\tfoo\n> new\n'
	],
	[
		'a straddled tab stays on a line that changes',
		'-\tfoo\n\tbar\n',
		'x on last line child 0',
		'listItem',
		'-\tfoo\n\tbarx\n'
	],
	[
		'a tab-indented nested item keeps its tab when it changes',
		'- a\n\t- b\n',
		'x on line 0 child 1',
		'listItem',
		'- a\n\t- bx\n'
	],
	[
		'an untouched straddled line keeps its tab',
		'-\tfoo\n\tbar\n',
		'x on line 0 child 0',
		'listItem',
		'-\tfoox\n\tbar\n'
	],
	[
		'a three-wide item keeps its straddled tab',
		'1. a\n\n \tb\n',
		'x on line 0 child 1',
		'listItem',
		'1. a\n\n \tbx\n'
	],
	[
		'a tab on the column keeps its byte prefix',
		'  -\ta\n\tb\n',
		'x on last line child 0',
		'listItem',
		'  -\ta\n\tbx\n'
	],
	[
		'a renumber re-indents to the new column',
		'1. a\n\n \tb\n',
		'marker renumbered or swapped',
		'listItem',
		'10. a\n\n     b\n'
	],
	['a lazy quote line stays lazy', '> a\nb\n', 'x on last line child 0', 'blockquote', '> a\nbx\n'],
	[
		'a new line above a lazy one takes the marker',
		'> a\nb\n',
		'line added child 0',
		'blockquote',
		'> a\n> new\nb\n'
	],
	['a lazy item line stays lazy', '- a\nb\n', 'x on last line child 0', 'listItem', '- a\nbx\n'],
	[
		'a lazy footnote line stays lazy',
		'[^1]: a\nb\n',
		'x on last line child 0',
		'footnote-def',
		'[^1]: a\nbx\n'
	],
	[
		'a task box is paragraph text to a lazy line below it',
		'- [x]\t> q\nx y\n',
		'x on last line child 0',
		'listItem',
		'- [x]\t> q\nx yx\n'
	],
	[
		'an item marker moves to the new first line',
		'p\n\n- a\n\n  b\n',
		'child 0 removed, next trivia cleared',
		'listItem',
		'- b\n'
	],
	[
		'a footnote marker moves to the new first line',
		'p\n\n[^1]: a\n\n    b\n',
		'child 0 removed, next trivia cleared',
		'footnote-def',
		'[^1]: b\n'
	],
	[
		'a quote emptied of all its text keeps its marker as spelled',
		'> quoted',
		'text deleted',
		'blockquote',
		'> '
	],
	['an emptied quote keeps an unspaced marker', '>quoted', 'text deleted', 'blockquote', '>'],
	['an emptied item keeps its marker', '- item', 'body emptied', 'listItem', '- '],
	[
		'an emptied footnote keeps its marker',
		'[^1]: A rock.\n',
		'text deleted',
		'footnote-def',
		'[^1]: \n'
	],
	[
		'an alert emptied of all its text keeps its head line and its body line’s marker',
		'> [!NOTE]\n> a\n',
		'text deleted',
		'githubAlert',
		'> [!NOTE]\n> \n'
	],
	[
		'an emptied callout keeps its fences',
		':::note Title\nx\n:::\n',
		'body emptied',
		'admonition',
		':::note Title\n:::\n'
	],
	[
		'a callout fence grows past a body closer',
		':::note\nx\n:::\n',
		'closer-like line added child 1',
		'admonition',
		'::::note\nx\n:::\n::::\n'
	],
	[
		'a quote line holding ::: is text',
		'> :::\n> a\n',
		'closer-like line added child 0',
		'blockquote',
		'> :::\n> :::\n> a\n'
	],
	[
		'the last child ends the file',
		'> a\n> b',
		'line added child 0',
		'blockquote',
		'> a\n> new\n> b'
	],
	[
		'the closing line ends the file',
		':::note\nx\n:::',
		'closer-like line added child 1',
		'admonition',
		'::::note\nx\n:::\n::::'
	],
	[
		'an alert head keeps its spelling',
		'>[!NOTE]\n> a\n',
		'x on line 0 child 0',
		'githubAlert',
		'>[!NOTE]\n> ax\n'
	],
	[
		'an alert head whose type changed is written the alert’s way',
		'>[!NOTE]\n> a\n',
		'type changed',
		'githubAlert',
		'> [!TIP]\n> a\n'
	],
	[
		'an untouched spelled line keeps its bytes',
		'> [!TIP]\n>b\n> c\n',
		'x on last line child 0',
		'githubAlert',
		'> [!TIP]\n>b\n> cx\n'
	],
	[
		'a longer closing line is kept',
		':::spoiler\nhidden\n:::::\n',
		'x on line 0 child 1',
		'directiveContainer',
		':::spoiler\nhiddenx\n:::::\n'
	]
];

describe('the built-in containers', () => {
	it.each([
		['blockquote', QUOTE_LINES],
		['listItem', LIST_ITEM_LINES],
		['directiveContainer', COLON_LINES]
	])('%s declares its lines and no rebuildRaw', (kind, lines) => {
		const descriptor = tryGetBlockKindDescriptor(kind as AnyBlockKind)!;
		expect([descriptor.lines, descriptor.rebuildRaw]).toEqual([lines, undefined]);
	});
});

describe('named rows', () => {
	it.each(NAMED_ROWS)('%s', (_, source, edit, kind, bytes) => {
		const rows = rowsOf(source, edit, shaped).filter((row) => row.kind === kind);
		expect(rows.map((row) => row.raw)).toEqual([bytes]);
	});

	// The emptied-container rule is for a whole quote: a reorder or a split inside one that still
	// holds text pairs a blank line with a line that had text, which must not lend it `> `.
	it('writes a line it empties in a quote still holding text as a bare `>`', () => {
		const quote = parse('> a\n> b\n> c\n').children[0];
		quote.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: 'a\n' },
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'c\n' }
		];
		writeContainerRaw(quote, defaultGrammarView);
		expect(quote.raw).toBe('> a\n>\n> c\n');
	});

	it('writes a blank line it adds to a quote as a bare `>`', () => {
		const quote = parse('> a\n').children[0];
		quote.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: 'a\n' },
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'b\n' }
		];
		writeContainerRaw(quote, defaultGrammarView);
		expect(quote.raw).toBe('> a\n>\n> b\n');
	});
});

describe('the editor’s grammar', () => {
	// A plugin the editor leaves off interrupts no paragraph there, so the line it would open stays
	// the quote's lazy line when the line above it changes.
	it('keeps a lazy line that only the editor’s grammar continues', () => {
		installPlugins([tocPlugin()]);
		const grammar = createEditorGrammar({ plugins: activationFor([]) });
		const quote = parse('> a\n[[toc]]\n', { grammar }).children[0];
		quote.children[0].raw = 'ab\n[[toc]]\n';
		writeContainerRaw(quote, grammar);
		expect(quote.raw).toBe('> ab\n[[toc]]\n');
	});
});
