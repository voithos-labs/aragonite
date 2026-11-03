// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { parrotPlugin } from './index';

const suite: PluginConformanceSuite = { plugins: [parrotPlugin()] };

export default suite;
