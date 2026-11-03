// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { footnotesPlugin, FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND } from './index';

const DEFINITION = '[^1]: A\n\n    B\n';

const suite: PluginConformanceSuite = {
	plugins: [footnotesPlugin()],
	containers: {
		[FOOTNOTE_DEF_KIND]: {
			deepNesting: { source: DEFINITION, leafPath: [0, 1] },
			// A blockquote > the definition > [paragraph, paragraph].
			localIndexFixture: {
				source: '> [^1]: A\n>\n>     B\n',
				containerChain: [0, 0],
				targetChild: 1
			},
			focusSource: DEFINITION,
			localIndex: { mode: 'assert' },
			ancestry: { mode: 'assert' },
			multiScope: {
				mode: 'exempt',
				reason: 'every operation inside a definition is single-scope, like a blockquote'
			},
			focusBubble: { mode: 'assert' },
			terminatorCollision: {
				mode: 'exempt',
				reason:
					'the rebuild indents every continuation line, so no body line can read as the end of the definition'
			}
		}
	},
	inline: [
		{
			trigger: '[',
			prefix: '[^',
			kind: FOOTNOTE_REF_KIND,
			fixtures: ['[^note]', 'see [^a] and [^b]'],
			// `[` is the link handler's own trigger, so every malformed reference falls through intact.
			overlapFixtures: ['[^]', '[^ spaced]', '[^unterminated', 'a [link [^ ] here](https://x.dev)'],
			overlapDecline: { mode: 'assert' },
			widget: { mode: 'assert' },
			editingPolicy: { mode: 'assert' },
			imageClaim: { mode: 'exempt', reason: 'the recognizer builds only its own inline kind' }
		}
	]
};

export default suite;
