// Every declaration reachable from the package's published entry points, in one file: the names a
// consumer already sees, which the contamination lint counts as public.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');

/** Writes the surface of the built declarations under `dist` to `out`; returns the count. */
export function writePublishedSurface(dist, out) {
	const entries = ['index.d.ts', 'plugin.d.ts', 'testing.d.ts'].map((f) => path.join(dist, f));
	const program = ts.createProgram(entries, { noEmit: true, skipLibCheck: true });
	const checker = program.getTypeChecker();
	const seen = new Set();
	const texts = [];
	const inDist = (d) => path.resolve(d.getSourceFile().fileName).startsWith(path.resolve(dist));
	const add = (symbol) => {
		if (!symbol) return;
		if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
		for (const decl of symbol.declarations ?? []) {
			if (seen.has(decl) || !inDist(decl)) continue;
			seen.add(decl);
			texts.push(decl.getText());
			(function visit(n) {
				if (
					ts.isTypeReferenceNode(n) ||
					ts.isExpressionWithTypeArguments(n) ||
					ts.isTypeQueryNode(n)
				) {
					const name = ts.isTypeReferenceNode(n)
						? n.typeName
						: ts.isTypeQueryNode(n)
							? n.exprName
							: n.expression;
					add(checker.getSymbolAtLocation(ts.isQualifiedName(name) ? name.right : name));
				}
				ts.forEachChild(n, visit);
			})(decl);
		}
	};
	for (const file of entries) {
		const source = program.getSourceFile(file);
		for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source)))
			add(symbol);
	}
	fs.writeFileSync(out, texts.join('\n\n') + '\n');
	return texts.length;
}
