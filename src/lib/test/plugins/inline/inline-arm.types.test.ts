// Fields an `inline()` arm can't use: each `@ts-expect-error` fails `npm run check` the day its
// mistake compiles again. The rows are type-checked, never run.
import { expect, it } from 'vitest';
import { inline } from '#lib/plugin.js';

const common = { label: 'Tag', prefix: '#t', match: /#t(\w+)/, sample: '#tx' };
const read = (m: RegExpExecArray) => ({ tag: m[1] });
const draw = () => ({});

function mistakes() {
	// A styled run of text follows a click as a widget does.
	const tag = inline({ ...common, name: 'a', read, class: 'tag', follow: (data) => void data.tag });
	// prettier-ignore
	// @ts-expect-error styled text draws nothing, so it has no `draw`
	const b = inline({ ...common, name: 'b', read, class: 'tag', draw });
	// prettier-ignore
	// @ts-expect-error a key is for a widget selected whole, which styled text never is
	const c = inline({ ...common, name: 'c', read, class: 'tag', key: () => false });
	// prettier-ignore
	// @ts-expect-error `depends` hands its answers to a drawing
	const d = inline({ ...common, name: 'd', read, class: 'tag', depends: () => '' });
	const link = { link: () => ({ href: 'x', text: 'x', title: null }) };
	// prettier-ignore
	// @ts-expect-error a link written in the plugin's syntax follows as a built-in link does
	const e = inline({ ...common, name: 'e', read, as: 'link', ...link, follow: () => {} });
	// prettier-ignore
	// @ts-expect-error a link draws no widget
	const f = inline({ ...common, name: 'f', read, as: 'link', ...link, draw });
	const image = { image: () => ({ src: 'x', alt: '', title: null, width: null, height: null }) };
	// prettier-ignore
	// @ts-expect-error an image draws no widget, so it takes no key
	const g = inline({ ...common, name: 'g', read, as: 'image', ...image, key: () => false });
	// prettier-ignore
	// @ts-expect-error nor a follow
	const h = inline({ ...common, name: 'h', read, as: 'image', ...image, follow: () => {} });
	// prettier-ignore
	// @ts-expect-error a claim is styled text or a link: the maker would draw one and drop the other
	const i = inline({ ...common, name: 'i', read, as: 'link', ...link, class: 'tag' });
	// prettier-ignore
	// @ts-expect-error nor styled text and an image
	const j = inline({ ...common, name: 'j', read, as: 'image', ...image, class: 'tag' });
	return [tag, b, c, d, e, f, g, h, i, j];
}

it('compiles the pins above', () => {
	expect(mistakes).toBeTypeOf('function');
});
