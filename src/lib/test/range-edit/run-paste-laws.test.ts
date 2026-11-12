// @vitest-environment jsdom
// The range-edit laws at a caret inside a format run, with blocks pasted there: a draw of its own,
// so the main draw's seeded documents stay the same. 60 carets in the commit gate, 300 with
// `RANGE_EDIT_FULL=1`.
// Miss-analysis: the main draw put one to nine block pastes a seed at a live caret in a run, and
// none behind a pasted last line with an underscore run, so two mutations of that cut stayed green.

import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { runPasteInputs } from './inputs';
import { describeLaws } from './law-suite';

const CARETS = process.env.RANGE_EDIT_FULL === '1' ? 300 : 60;
const SEED = freshOrFixedSeed(20261111);

describeLaws('the range-edit laws at a caret inside a format run', CARETS, () =>
	runPasteInputs(CARETS, SEED)
);
