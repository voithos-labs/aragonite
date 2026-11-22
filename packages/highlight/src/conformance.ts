// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { Conformance } from '@voithos-labs/aragonite/testing';
import { highlight, type HighlightOptions } from './index';
import { highlightJs } from './renderer';

// With no renderer the plugin lists nothing, so the checks run it with the bundled one.
const suite: Conformance<HighlightOptions> = {
	plugin: highlight,
	options: { renderer: highlightJs() }
};

export default suite;
