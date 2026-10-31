// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { detailsPlugin, DETAILS } from './index';

// outer details > inner details (child 1, after the summary) > [summary, paragraph, paragraph].
const NESTED =
	'<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nA\n\nB\n\n' +
	'</details>\n\n</details>\n';

const suite: PluginConformanceSuite = {
	plugins: [detailsPlugin()],
	containers: {
		[DETAILS]: {
			deepNesting: { source: NESTED, leafPath: [0, 1, 1] },
			localIndexFixture: { source: NESTED, containerChain: [0, 1], targetChild: 2 },
			focusSource: '<details open>\n<summary>S</summary>\n\nA\n\nB\n\n</details>\n',
			terminatorCollisionFixture: {
				source: '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n',
				bodyRaw: '</details>\n'
			},
			localIndex: { mode: 'assert' },
			ancestry: { mode: 'assert' },
			multiScope: {
				mode: 'exempt',
				reason: 'every operation inside a details block is single-scope, like a blockquote'
			},
			focusBubble: { mode: 'assert' },
			terminatorCollision: { mode: 'assert' }
		}
	}
};

export default suite;
