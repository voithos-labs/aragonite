// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { INLINE_PRIORITIES } from '@voithos-labs/aragonite/plugin';
import { emojiPlugin, EMOJI_KIND } from './index';

const suite: PluginConformanceSuite = {
	plugins: [emojiPlugin()],
	inline: [
		{
			trigger: ':',
			priority: INLINE_PRIORITIES.plugin + 10,
			kind: EMOJI_KIND,
			fixtures: [':smile:', 'ship it :rocket: now'],
			// `:` is shared with directive text and with prose that merely holds a colon.
			overlapFixtures: [
				':name[label]',
				':name{.cls}',
				'meet at 10:30',
				'see https://x.dev',
				':notaname:'
			],
			overlapDecline: { mode: 'assert' },
			widget: { mode: 'assert' },
			editingPolicy: { mode: 'assert' },
			imageClaim: { mode: 'exempt', reason: 'the recognizer builds only its own inline kind' }
		}
	]
};

export default suite;
