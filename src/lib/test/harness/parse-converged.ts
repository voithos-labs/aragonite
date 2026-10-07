// The parse-comparison check, offered to unit suites under the name `expectParseConverged`. The
// comparison itself lives in the published testing folder (`testing/parse-convergence.ts`), so
// the kit, this harness and the e2e bridge all share one implementation; that module's header
// says what it replaces and what it tolerates.

import type { CstNode } from '#lib/core/nodes.js';

export {
	assertParseConverged as expectParseConverged,
	parseConverges,
	describeConvergence
} from '#lib/testing/parse-convergence.js';

// ── The views the separator suites assert against ────────────────────────────

export const layoutOf = (nodes: readonly CstNode[]): [string, string, string][] =>
	nodes.map((n) => [n.kind, n.leadingTrivia, n.raw]);

export const triviaRawOf = (nodes: readonly CstNode[]): [string, string][] =>
	nodes.map((n) => [n.leadingTrivia, n.raw]);
