// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { latexPlugin, MATH_INLINE } from './index';

const suite: PluginConformanceSuite = {
	plugins: [latexPlugin()],
	inline: [
		{
			trigger: '$',
			kind: MATH_INLINE,
			fixtures: ['$x^2$', 'let $a+b$ be', 'one part in $10^5$'],
			// Shell and currency prose is why a `$` match is guarded at all.
			overlapFixtures: ['$5 and $10', '$ x $', '$HOME and $PATH', 'costs $9', 'between $10-$20'],
			overlapDecline: { mode: 'assert' },
			widget: { mode: 'assert' },
			editingPolicy: { mode: 'assert' },
			imageClaim: { mode: 'exempt', reason: 'the recognizer builds only its own inline kind' }
		}
	]
};

export default suite;
