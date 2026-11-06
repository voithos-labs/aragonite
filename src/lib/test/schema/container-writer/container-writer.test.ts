// The container writer against today's per-kind writers, over named documents for tab columns,
// lazy lines and the container facts, and the law harness's and respelled containers' draws.
// `CONTAINER_WRITER_DIFF=full` adds the behavior corpus and the spec's examples, with more draws.
import { beforeEach, describe, expect, it } from 'vitest';
import { devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { perfEnabled } from '#lib/perf/instruments.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { COLON_LINES, fencedLines, writeShapedRaw } from '#lib/schema/container-writer.js';
import { QUOTE_LINES } from '#lib/core/parsers/blockquote.js';
import { LIST_ITEM_LINES } from '#lib/core/parsers/list.js';
import type { IndentedLines, LineShape, MarkedLines } from '#lib/core/strip-lines.js';
import type { CstNode } from '#lib/core/nodes.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { differentialDocuments, rowsOf, runDifferential, type Writer } from './differential';

const ALERT_LINES: MarkedLines<{ alertType: string }> = {
	...QUOTE_LINES,
	head: {
		match: /^[ \t]*\[!([A-Za-z]+)\][ \t]*$/,
		data: (match) => ({ alertType: match[1] }),
		write: (data) => `[!${data.alertType}]`
	}
};

const DEFINITION_LINES: IndentedLines<{ label: string }> = {
	shape: 'indented',
	open: /^ {0,3}\[\^([^\]]+)\]: ?/,
	data: (match) => ({ label: match[1] }),
	first: (data) => `[^${data.label}]: `,
	rest: () => '    ',
	lazy: true
};

const DETAILS_LINES = fencedLines<{ open: boolean }>({
	open: (data, title) => [`<details${data.open ? ' open' : ''}>`, `<summary>${title}</summary>`],
	close: () => '</details>'
});

const SHAPES: Record<string, LineShape<never>> = {
	blockquote: QUOTE_LINES,
	githubAlert: ALERT_LINES as LineShape<never>,
	listItem: LIST_ITEM_LINES as LineShape<never>,
	'footnote-def': DEFINITION_LINES as LineShape<never>,
	directiveContainer: COLON_LINES,
	admonition: COLON_LINES,
	details: DETAILS_LINES as LineShape<never>
};

const today: Writer = (node, changed) =>
	tryGetBlockKindDescriptor(node.kind)!.rebuildRaw!(node, changed);
const shaped: Writer = (node: CstNode, changed) => writeShapedRaw(node, SHAPES[node.kind], changed);

beforeEach(() => {
	installPlugins([admonitionsPlugin(), detailsPlugin(), footnotesPlugin()]);
});

describe('the container writer against today’s writers', () => {
	it('gives the same bytes and asks for the same rereads', () => {
		// A region splice compares itself with a full rebuild only under the dev checks.
		expect([devChecksOn, perfEnabled()]).toEqual([true, false]);
		const scale = process.env.CONTAINER_WRITER_DIFF === 'full' ? 'full' : 'quick';
		const tally = runDifferential(differentialDocuments(scale, 20261106), today, shaped);
		expect(tally.cases).toBeGreaterThan(scale === 'full' ? 100_000 : 1_000);
		expect(tally.throws).toEqual([]);
		expect(tally.warns).toEqual({});
		expect(tally.mismatches.slice(0, 3)).toEqual([]);
	}, 600_000);
});

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
		'a straddled tab is spaces once its line changes',
		'-\tfoo\n\tbar\n',
		'x on last line child 0',
		'listItem',
		'-\tfoo\n    barx\n'
	],
	[
		'an untouched straddled line keeps its tab',
		'-\tfoo\n\tbar\n',
		'x on line 0 child 0',
		'listItem',
		'-\tfoox\n\tbar\n'
	],
	[
		'a three-wide item rewrites its straddled line',
		'1. a\n\n \tb\n',
		'x on line 0 child 1',
		'listItem',
		'1. a\n\n    bx\n'
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
		'an emptied quote is >, where the facts say "> "',
		'> quoted',
		'text deleted',
		'blockquote',
		'>'
	],
	['an emptied item keeps its marker', '- item', 'body emptied', 'listItem', '- '],
	[
		'an emptied footnote keeps its marker',
		'[^1]: A rock.\n',
		'text deleted',
		'footnote-def',
		'[^1]: \n'
	],
	[
		'an emptied alert keeps its head line',
		'> [!NOTE]\n> a\n',
		'text deleted',
		'githubAlert',
		'> [!NOTE]\n>\n'
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
		'an alert head is respelled, where the facts keep it',
		'>[!NOTE]\n> a\n',
		'x on line 0 child 0',
		'githubAlert',
		'> [!NOTE]\n> ax\n'
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

describe('named rows', () => {
	it.each(NAMED_ROWS)('%s', (_, source, edit, kind, bytes) => {
		const rows = rowsOf(source, edit, shaped).filter((row) => row.kind === kind);
		expect(rows.map((row) => row.raw)).toEqual([bytes]);
	});
});
