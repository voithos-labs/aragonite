// @vitest-environment jsdom
// Miss-analysis: the url-extent rows ran with no plugin installed, and the plugin fuzz drew no url.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { parseInline } from '#lib/core/inline/index.js';
import { grammar } from '#lib/plugin.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { emoji } from '#packages/emoji/src/index.js';
import { grammarListing } from './grammar-listing';

beforeEach(() => {
	installPlugins([
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		footnotesPlugin()
	]);
});

const ALL = ['latex', 'footnotes'];

const read = (raw: string, names: string[]) =>
	parseInline(raw, 0, raw.length, undefined, grammarListing(names)).map((node) => ({
		kind: node.kind,
		bytes: raw.slice(node.start, node.end)
	}));

describe('a bare url ends where plugin syntax the editor reads starts', () => {
	it.each([
		['math', 'see https://a.co/?q=$x$ y', 'https://a.co/?q=', 'math'],
		[
			'a footnote reference',
			'Visit https://example.com[^1] now',
			'https://example.com',
			'footnote-ref'
		]
	])('%s', (_name, raw, url, kind) => {
		const nodes = read(raw, ALL);
		expect(nodes[1]).toEqual({ kind: 'autolink', bytes: url });
		expect(nodes[2].kind).toBe(kind);
	});

	it('a link whose label holds math with a bracket is never taken into the url', () => {
		expect(read('www.a.co/[$a]b$](u)', ALL).map((node) => node.kind)).toEqual(['autolink', 'link']);
	});

	it.each([
		['http://a.co/[a:b] x', 'http://a.co/[a:b]'],
		['http://a.co/[a$b] x', 'http://a.co/[a$b]']
	])('%j keeps a bracket no plugin syntax runs over', (raw, url) => {
		expect(read(raw, ALL)[0]).toEqual({ kind: 'autolink', bytes: url });
	});

	it.each([
		['see https://a.co/?q=$x$ y', 'https://a.co/?q=$x$'],
		['Visit https://example.com[^1] now', 'https://example.com[^1]'],
		['www.a.co/[$a]b$](u)', 'www.a.co/[$a]b$](u)']
	])('%j runs on as prose where the plugins are left out', (raw, url) => {
		expect(read(raw, []).find((node) => node.kind === 'autolink')?.bytes).toBe(url);
	});
});

// The same edge for a construct a plugin value contributes, read through its editor's grammar.
describe("a bare url ends where a plugin value's syntax starts", () => {
	const urlIn = (raw: string, plugins: (typeof emoji)[]) =>
		grammar(plugins)
			.parse(`${raw}\n`)
			.blocks[0].pieces.map((piece) => ({
				kind: piece.kind,
				bytes: raw.slice(piece.from, piece.to)
			}))
			.find((piece) => piece.kind === 'autolink')?.bytes;

	it.each([
		['see www.a.co/a:smile: y', 'www.a.co/a'],
		['http://a.co/[a:smile:b] x', 'http://a.co/[a']
	])('%j stops before an emoji', (raw, url) => {
		expect(urlIn(raw, [emoji])).toBe(url);
	});

	it('runs on as prose where emoji is left out', () => {
		expect(urlIn('see www.a.co/a:smile: y', [])).toBe('www.a.co/a:smile');
	});
});
