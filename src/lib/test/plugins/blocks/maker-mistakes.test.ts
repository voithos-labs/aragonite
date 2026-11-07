// Mistakes a block type's author can't write: each `@ts-expect-error` fails `npm run check` the day
// its mistake compiles again. The rows are type-checked, never run.
import { describe, expect, it } from 'vitest';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { builtin } from '#lib/components/block-makers/builtin.js';

const line = { label: 'L', sample: '%%l' };

// Never called: a mistaken spec is only ever read by the type checker.
function mistakes() {
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
	// @ts-expect-error not an icon the menus draw
	const e = lineBlock({ ...line, name: 'e', match: /^%%e$/, icon: 'sparkly-unicorn' });
	const fine = lineBlock({
		...line,
		name: 'f',
		match: /^%%f (?<n>\d)$/,
		data: (m) => Number(m.groups!.n),
		write: (n) => `%%f ${n}`,
		before: builtin.blocks.heading
	});
	return [a, b, c, d, e, fine];
}

describe('a block type mistake', () => {
	it('is a compile error, checked by `npm run check`', () => {
		expect(mistakes).toBeTypeOf('function');
	});
});
