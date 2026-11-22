// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { Conformance } from '@voithos-labs/aragonite/testing';
import { spellcheckPlugin, type SpellcheckOptions } from './index';

// The English word list loads on first ask, after a paint answered; a dictionary that answers at
// once, calling every word wrong, has the checks place a wave under each word of every sample.
const suite: Conformance<SpellcheckOptions> = {
	plugin: spellcheckPlugin,
	options: { dictionary: { check: () => false, suggest: () => [] } }
};

export default suite;
