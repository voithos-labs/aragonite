// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { highlight } from './index';
import { highlightJs } from './renderer';

const suite: PluginConformanceSuite = { plugins: [highlight({ renderer: highlightJs() })] };

export default suite;
