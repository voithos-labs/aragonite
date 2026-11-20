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

const line = { label: 'L', sample: '%%l', insert: { none: 'a compile row' } };

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
	const fine = lineBlock({
		...line,
		name: 'f',
		match: /^%%f (?<n>\d)$/,
		data: (m) => Number(m.groups!.n),
		write: (n) => `%%f ${n}`,
		before: builtin.blocks.heading
	});
	// @ts-expect-error a block type whose lines carry no data can't be given any
	draft.data(plain, 1);
	// @ts-expect-error a block not narrowed to its type can't be given data
	draft.data(numbered.children[0], 1);
	draft.data(numbered, 2);
	return [a, b, c, d, e, f, g, h, i, j, fine];
}

describe('a block type mistake', () => {
	it('is a compile error, checked by `npm run check`', () => {
		expect(mistakes).toBeTypeOf('function');
	});
});
