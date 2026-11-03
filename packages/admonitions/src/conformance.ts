// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { admonitionsPlugin } from './index';
import { ADMONITION, GITHUB_ALERT } from './kinds';

const SINGLE_SCOPE = 'every operation inside the block is single-scope, like a blockquote';

// outer `::::note` > inner `:::tip` (child 1, after the title row) > [title, paragraph, paragraph].
const NESTED = '::::note Outer\n:::tip Inner\nA\n\nB\n:::\n::::\n';

const suite: PluginConformanceSuite = {
	plugins: [admonitionsPlugin()],
	containers: {
		[ADMONITION]: {
			deepNesting: { source: NESTED, leafPath: [0, 1, 1] },
			localIndexFixture: { source: NESTED, containerChain: [0, 1], targetChild: 2 },
			focusSource: ':::note T\nA\n\nB\n:::\n',
			terminatorCollisionFixture: {
				source: ':::note T\nbody\n:::\n',
				bodyRaw: 'before\n:::\nafter\n'
			},
			localIndex: { mode: 'assert' },
			ancestry: { mode: 'assert' },
			multiScope: { mode: 'exempt', reason: SINGLE_SCOPE },
			focusBubble: { mode: 'assert' },
			terminatorCollision: { mode: 'assert' }
		},
		[GITHUB_ALERT]: {
			deepNesting: { source: '> [!NOTE]\n> A\n>\n> B\n', leafPath: [0, 1] },
			// A blockquote > the alert > [paragraph, paragraph].
			localIndexFixture: {
				source: '> > [!NOTE]\n> > A\n> >\n> > B\n',
				containerChain: [0, 0],
				targetChild: 1
			},
			focusSource: '> [!NOTE]\n> A\n>\n> B\n',
			localIndex: { mode: 'assert' },
			ancestry: { mode: 'assert' },
			multiScope: { mode: 'exempt', reason: SINGLE_SCOPE },
			focusBubble: { mode: 'assert' },
			terminatorCollision: {
				mode: 'exempt',
				reason:
					'the rebuild puts a quote marker before every body line, so no body line can read as the end of the alert'
			}
		}
	}
};

export default suite;
