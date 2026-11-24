// @vitest-environment jsdom
// A fenced container's title row is named and classed as its title line declares, under a kind of
// its own type's, so two titled types in one editor never share a row.
// Miss-analysis: every titled fenced container held one shared row kind called "Title", so no row
// read a row's name or class off the line that declares it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { container, definePlugin, fencedLines } from '#lib/plugin.js';
import type { CstNode } from '#lib/core/nodes.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { fold } from '#lib/test/support/fold-fixture.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const aside = container<{ wide: boolean }>({
	name: 'aside',
	label: 'Aside',
	lines: fencedLines<{ wide: boolean }>({
		open: /^\[aside( wide)?\]/,
		data: (match) => ({ wide: match[1] !== undefined }),
		write: (data) => (data.wide ? '[aside wide]' : '[aside]'),
		title: {
			match: /^heading: (?<text>.*)$/,
			write: (title) => `heading: ${title}`,
			label: 'Heading',
			className: 'aside-heading'
		},
		close: { match: /^\[\/aside\]/, write: () => '[/aside]' },
		escape: (line) => line.replace('[', '\\[')
	}),
	sample: '[aside]\nheading: H\n\nbody\n\n[/aside]',
	insert: { none: 'a test block type' }
});

const plugin = definePlugin({
	name: 'rows',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: [fold, aside] })
});

const SOURCE = '[fold]\ntitle: F\n\nbody\n\n[/fold]\n\n[aside]\nheading: H\n\nbody\n\n[/aside]\n';

describe('a title row as its line declares it', () => {
	it('takes its type’s own kind, name and class, and the defaults where the line names none', async () => {
		const m = mountEditor<{ getDocument(): CstNode }>({ source: SOURCE, plugins: [plugin] });
		await m.settle();
		const rows = [0, 1].map((index) => {
			const node = m.instance.__test.getDocument().children![index].children![0];
			const surface = surfaceAt(m, [index, 0]);
			return {
				kind: node.kind,
				name: surface.getAttribute('aria-label'),
				classed: [...surface.classList].filter((c) => /title-row|aside-heading/.test(c))
			};
		});
		expect(rows).toEqual([
			{ kind: 'rows/fold.title', name: 'Title', classed: ['title-row'] },
			{ kind: 'rows/aside.title', name: 'Heading', classed: ['aside-heading'] }
		]);
	});
});
