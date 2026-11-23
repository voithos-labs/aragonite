// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { Conformance } from '@voithos-labs/aragonite/testing';
import { latex, type LatexOptions } from './index';

const suite: Conformance<LatexOptions> = { plugin: latex };

export default suite;
