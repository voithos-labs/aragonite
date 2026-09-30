// Backspace at the start of a container's first child lifts it out, and the blank line that stood
// between that child and the next one stays between the lifted block and the container.
// Miss-analysis (GH #557): the quote's lift and the kept-container lift were two copies of one
// rule, and each had its own tests, so no test ran both over the same shape.

import { describe, it, expect, beforeEach } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { firstChildUnwrapStrategies } from '$lib/editor-actions/unwrap-strategies';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { makeBlockListState, makeTopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

beforeEach(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
});

/** The container's declared first-child strategy, with the real top-level edit as its parent. */
async function backspaceAtFirstChild(source: string) {
	const h = makeTopHarness(source);
	const node = () => h.deps.doc.children[0];
	const role = getBlockKindDescriptor(node().kind).unwrapRole!;
	await firstChildUnwrapStrategies[role.firstChildBackspace]({
		deps: {
			index: 0,
			path: [0],
			get node() {
				return node();
			},
			parent: { blockEdit: h.actions },
			reading: h.deps.reading
		} as never,
		state: makeBlockListState(node)
	});
	return h.deps.doc;
}

describe('lifting a container’s first child keeps the blank line below it', () => {
	it.each([
		['a quote', '> A\n>\n> B\n', 'A\n\n> B\n'],
		['an alert', '> [!NOTE]\n> A\n>\n> B\n', 'A\n\n> B\n'],
		['a quote with the next child flush', '> # A\n> B\n', '# A\n> B\n'],
		['a footnote definition', '[^1]: A\n\n    B\n', 'A\n\n[^1]: B\n']
	])('%s', async (_name, source, after) => {
		const doc = await backspaceAtFirstChild(source);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});
