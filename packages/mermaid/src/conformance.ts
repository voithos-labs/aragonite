// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { Conformance } from '@voithos-labs/aragonite/testing';
import { mermaid, type MermaidOptions } from './index';

const suite: Conformance<MermaidOptions> = { plugin: mermaid };

export default suite;
