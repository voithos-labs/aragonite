// The parse-convergence oracle, surfaced for unit suites under the harness name
// `expectParseConverged`. The comparison is single-sourced in the published
// testing dir (`$lib/testing/parse-convergence`) so the kit, this harness, and
// the e2e bridge all share one implementation; see that module's header for the
// tautology it replaces and the transients it tolerates.

export {
	assertParseConverged as expectParseConverged,
	parseConverges,
	describeConvergence
} from '$lib/testing/parse-convergence';
