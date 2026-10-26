/**
 * G4.255: every `test.fixme` names the issue it waits on, as a reason starting `#<number>: `, so
 * the release step that re-runs fixme rows (`scripts/release/fixme-recheck.mjs`) can say which issue a
 * passing row belongs to.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { collectFiles, readSource } from '../../test/invariants/lint/scan-source';

const REASON = /^#\d+: \S/;

/** Each `test.fixme(...)` or `test.describe.fixme(...)` call, with whether it names an issue. */
function fixmeCalls(file: string, text: string) {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const calls: { at: string; namesIssue: boolean }[] = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === 'fixme' &&
			/^test\b/.test(node.expression.expression.getText(source))
		) {
			const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
			calls.push({
				at: `${file}:${line}`,
				namesIssue: node.arguments.some(
					(arg) => ts.isStringLiteralLike(arg) && REASON.test(arg.text)
				)
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return calls;
}

describe('G4.255 a fixme row names its issue', () => {
	const calls = collectFiles('src/lib/e2e/tests', { extensions: ['.ts'] })
		.map(readSource)
		.flatMap(({ relPath, text }) => fixmeCalls(relPath, text));

	it('every fixme reason starts with #<issue>:', () => {
		expect(calls.filter((call) => !call.namesIssue).map((call) => call.at)).toEqual([]);
	});

	it.each([
		["test.fixme(browserName === 'webkit', '#353: overlay absent');", true],
		["test.fixme(true, 'the caret drops beside the image');", false],
		['test.fixme();', false],
		["test.describe.fixme('#12: a group', () => {});", true]
	])('reads %s', (source, namesIssue) => {
		expect(fixmeCalls('probe.spec.ts', source)).toEqual([{ at: 'probe.spec.ts:1', namesIssue }]);
	});
});
