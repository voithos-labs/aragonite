// @vitest-environment jsdom
// The range-edit laws over documents built around HTML blocks of all seven types, drawn apart from
// the main draw so its seeded documents stay the same: 40 in the commit gate, 200 with
// `RANGE_EDIT_FULL=1`.

import { arbHtmlLawDocument } from '../range-laws/shapes';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { lawInputs } from './inputs';
import { describeLaws } from './law-suite';

const DOCUMENTS = process.env.RANGE_EDIT_FULL === '1' ? 200 : 40;
const SEED = freshOrFixedSeed(20261109);

describeLaws('the range-edit laws over HTML blocks', DOCUMENTS, (grammar) =>
	lawInputs(DOCUMENTS, SEED, grammar, arbHtmlLawDocument)
);
