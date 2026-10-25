// Empties a built script's prose string literals (messages, descriptions) and fails on a comment
// left in it: the blind side runs the parser, it never reads why the parser's authors wrote it.
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');
const K = ts.SyntaxKind;

/** A message names the function that raised it, as `fnName: ...` or a bare `registerX` argument. */
const caller = (text) => /^[a-z]+[A-Z][A-Za-z]*(: |$)/.test(text);
/** Sample documents and pattern sources carry newlines, leading markup or pattern syntax; messages don't. */
const prose = (text) =>
	/ /.test(text) &&
	!/\n|\(\?|\{\d|^[\s<[#>|*-]/.test(text) &&
	/[A-Za-z]{2,}[^A-Za-z]+[A-Za-z]{2,}/.test(text);

/** `code` with every prose literal emptied; throws when a comment survives. */
export function scrub(code) {
	const file = ts.createSourceFile(
		'built.mjs',
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	const edits = [];
	(function visit(node) {
		const k = node.kind;
		// A registry's label names it in messages only.
		if (
			ts.isPropertyAssignment(node) &&
			node.name.getText(file) === 'label' &&
			ts.isStringLiteral(node.initializer) &&
			/^[a-z]+[A-Z]/.test(node.initializer.text)
		) {
			edits.push([node.initializer.getStart(file), node.initializer.getEnd(), '"registry"']);
			return;
		}
		const literal = k === K.StringLiteral || k === K.NoSubstitutionTemplateLiteral;
		if (literal && (prose(node.text) || (caller(node.text) && /^register/.test(node.text)))) {
			const quote = code[node.getStart(file)];
			edits.push([node.getStart(file), node.getEnd(), quote + quote]);
		} else if (
			(k === K.TemplateHead || k === K.TemplateMiddle || k === K.TemplateTail) &&
			(prose(node.text) || caller(node.text))
		) {
			const open = k === K.TemplateHead ? '`' : '}';
			const close = k === K.TemplateTail ? '`' : '${';
			edits.push([node.getStart(file), node.getEnd(), open + close]);
		}
		ts.forEachChild(node, visit);
	})(file);
	let out = code;
	for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
		out = out.slice(0, start) + text + out.slice(end);
	}
	let comments = 0;
	const count = () => comments++;
	(function visit(node) {
		ts.forEachLeadingCommentRange(out, node.pos, count);
		ts.forEachTrailingCommentRange(out, node.end, count);
		ts.forEachChild(node, visit);
	})(ts.createSourceFile('out.mjs', out, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
	if (comments > 0) throw new Error(`${comments} comment(s) left in the built script`);
	return { code: out, emptied: edits.length };
}
