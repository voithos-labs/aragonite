// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type { Conformance } from '@voithos-labs/aragonite/testing';
import { footnotes } from './index';

const suite: Conformance = { plugin: footnotes };

export default suite;
