// Mistakes a block type's author can't write: each `@ts-expect-error` fails `npm run check` the day
// its mistake compiles again. The rows are type-checked, never run.
import { describe, expect, it } from 'vitest';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import { builtin } from '#lib/components/block-makers/builtin.js';
import { container } from '#lib/components/block-makers/container.js';
import { COLON_LINES } from '#lib/schema/colon-lines.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { Draft } from '#lib/schema/drafts.js';
import type { IndentedLines } from '#lib/core/strip-lines.js';
import { command } from '#lib/schema/plugin-command.js';

const line = { label: 'L', sample: '%%l', insert: { none: 'a compile row' } };
const MARKED = { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true } as const;

// Never called: a mistaken spec is only ever read by the type checker.
function mistakes(draft: Draft, plain: Block<never>, numbered: Block<number>) {
	// prettier-ignore
	// @ts-expect-error data read from the line needs a `write` to put it back
	const a = lineBlock({ ...line, name: 'a', match: /^%%a (\d)$/, data: (m: RegExpExecArray) => m[1] });
	// prettier-ignore
	// @ts-expect-error `write` needs `data`
	const b = lineBlock({ ...line, name: 'b', match: /^%%b$/, write: () => '%%b' });
	// A place is the block type it goes before, never a number.
	// @ts-expect-error `before` takes block types
	const c = lineBlock({ ...line, name: 'c', match: /^%%c$/, before: 3 });
	// The checks drive a block type through its sample.
	// @ts-expect-error `sample` is required
	const d = lineBlock({ name: 'd', label: 'D', match: /^%%d$/ });
	// The insert menus list every block type that doesn't say why they can't.
	// @ts-expect-error `insert` is required
	const i = lineBlock({ name: 'i', label: 'I', sample: '%%i', match: /^%%i$/ });
	// @ts-expect-error not an icon the menus draw
	const e = lineBlock({ ...line, name: 'e', match: /^%%e$/, icon: 'sparkly-unicorn' });
	// prettier-ignore
	// @ts-expect-error a box has no text for the editor to show, so `edit: 'box'` needs `draw`
	const f = fencedBlock({ ...line, name: 'f', fence: { info: 'f' }, edit: 'box' });
	const g = lineBlock({
		...line,
		name: 'g',
		match: /^%%g$/,
		edit: 'box',
		draw: (_block, ctx) => {
			// @ts-expect-error a box's context has no text element to place
			const dom = ctx.source;
			return { dom };
		}
	});
	// prettier-ignore
	// @ts-expect-error a fenced block's lines carry no data
	const h = fencedBlock({ ...line, name: 'h', fence: { info: 'h' }, data: () => 1, write: () => '' });
	// A pasted closing line can't say which container it ends, so the maker takes no shape with one.
	// @ts-expect-error a container's lines are marked or indented, never closed by a line
	const j = container({ ...line, name: 'j', lines: COLON_LINES, merges: {} });
	// prettier-ignore
	// @ts-expect-error a container's data is an object, which its writer lays its metadata over
	const m = container({ ...line, name: 'm', lines: { ...MARKED, head: { match: /^!(\w+)$/, data: (x: RegExpExecArray) => x[1], write: (t: string) => t } } });
	// @ts-expect-error and so is a line shape's
	const n: IndentedLines<string> | null = null;
	const fine = lineBlock({
		...line,
		name: 'f',
		match: /^%%f (?<n>\d)$/,
		data: (m) => Number(m.groups!.n),
		write: (n) => `%%f ${n}`,
		before: builtin.blocks.heading
	});
	// What a block type reads of the document is handed to its drawings, so one needs a `draw`.
	// @ts-expect-error `depends` without `draw`
	const k = lineBlock({ ...line, name: 'k', match: /^%%k$/, depends: () => '' });
	// @ts-expect-error a container's `depends` needs its own `draw` too
	const l = container({ ...line, name: 'l', lines: MARKED, depends: () => '' });
	const reads = lineBlock({
		...line,
		name: 'reads',
		match: /^%%reads$/,
		depends: (block) => block.text,
		draw: (_block, ctx) => ({ dom: ctx.source })
	});
	// @ts-expect-error a block type whose lines carry no data can't be given any
	draft.data(plain, 1);
	// @ts-expect-error a block not narrowed to its type can't be given data
	draft.data(numbered.children[0], 1);
	draft.data(numbered, 2);
	// A block type's command reads the handle its drawing declares, and no other.
	const dom = () => document.createElement('div');
	const opens = command<Block<never>, { open(): void }>({
		id: 'opens',
		title: 'Opens',
		run: (_editor, _block, ui) => ui?.open()
	});
	const box = { ...line, fence: { info: 'o' }, edit: 'box' } as const;
	const row = { label: 'Open', command: opens };
	const o = fencedBlock({
		...box,
		name: 'o',
		actions: [row],
		draw: () => ({ dom: dom(), handle: { open() {} } })
	});
	// prettier-ignore
	// @ts-expect-error the drawing hands another handle than its type's command reads
	const p = fencedBlock({ ...box, name: 'p', actions: [row], draw: () => ({ dom: dom(), handle: { shut() {} } }) });
	// A drawing with no handle compiles: its commands are handed undefined, which they take anyway.
	const q = fencedBlock({ ...box, name: 'q', actions: [row], draw: () => ({ dom: dom() }) });
	const both = command<Block<never>, { open(): void; shut(): void }>({
		id: 'both',
		title: 'Both',
		run: (_editor, _block, ui) => ui?.shut()
	});
	const rows = [row, { label: 'Both', command: both }];
	// prettier-ignore
	// @ts-expect-error the drawing hands less than one of its type's commands reads
	const u = fencedBlock({ ...box, name: 'u', actions: rows, draw: () => ({ dom: dom(), handle: { open() {} } }) });
	return [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, u, reads, fine];
}

describe('a block type mistake', () => {
	it('is a compile error, checked by `npm run check`', () => {
		expect(mistakes).toBeTypeOf('function');
	});
});
