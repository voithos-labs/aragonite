import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { collectCrossBlockText } from '$lib/selection/clipboard-text';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';

// A partial mid-leaf clipboard slice from the SOLE child of a strip container must keep
// the container's per-line marker prefix, or the slice reparses as bare text and the
// container kind is lost on paste. Eligibility is the descriptor's `strip` contract
// (raw is a per-line marker around serialize(children)), not a hardcoded kind list —
// so githubAlert and footnote-def recover their wrapper exactly as listItem and
// blockquote always have.

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

describe('collectCrossBlockText — sole-child strip-container prefix recovery', () => {
	for (const c of cases) {
		it(`${c.name}: a partial mid-leaf slice keeps the ${JSON.stringify(c.prefix)} wrapper`, () => {
			const doc = parse(c.src);
			const text = collectCrossBlockText(
				doc,
				{ path: c.leaf, offset: 2 },
				{ path: [1], offset: 3 }
			);
			// Pre-fix (githubAlert, footnote-def): the marker recovery returned null, so the
			// slice began "pha…" with the wrapper gone.
			expect(text.startsWith(c.prefix + 'pha')).toBe(true);
		});
	}
});
