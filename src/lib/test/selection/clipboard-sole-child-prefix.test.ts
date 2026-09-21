import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { collectCrossBlockText } from '$lib/selection/clipboard-text';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';

// A partial slice from the sole child of a strip container (a list item, a blockquote) must keep
// the container's marker prefix, or it reparses as bare text. Eligibility is the descriptor's
// `strip` contract, not a hard-coded kind list.

beforeAll(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
});

interface PrefixCase {
	name: string;
	src: string;
	leaf: number[];
	prefix: string;
}

const cases: PrefixCase[] = [
	{ name: 'listItem', src: '- alpha\n\nafter\n', leaf: [0, 0, 0], prefix: '- ' },
	{ name: 'blockquote', src: '> alpha\n\nafter\n', leaf: [0, 0], prefix: '> ' },
	{
		name: 'githubAlert',
		src: '> [!NOTE]\n> alpha\n\nafter\n',
		leaf: [0, 0],
		prefix: '> [!NOTE]\n> '
	},
	{ name: 'footnote-def', src: '[^a]: alpha\n\nafter\n', leaf: [0, 0], prefix: '[^a]: ' }
];

describe('collectCrossBlockText: sole-child strip-container prefix recovery', () => {
	for (const c of cases) {
		it(`${c.name}: a partial mid-leaf slice keeps the ${JSON.stringify(c.prefix)} wrapper`, () => {
			const doc = parse(c.src);
			const text = collectCrossBlockText(
				doc,
				{ path: c.leaf, offset: 2 },
				{ path: [1], offset: 3 }
			);
			// The prefix is the half that matters: a null marker recovery leaves the slice
			// starting at "pha…" with nothing in front of it.
			expect(text.startsWith(c.prefix + 'pha')).toBe(true);
		});
	}
});
