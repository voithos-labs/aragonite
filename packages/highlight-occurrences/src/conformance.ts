// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { highlightOccurrencesPlugin } from './index';

const suite: PluginConformanceSuite = { plugins: [highlightOccurrencesPlugin()] };

export default suite;
