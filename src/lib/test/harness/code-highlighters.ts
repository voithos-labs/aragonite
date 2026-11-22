// Editor activations whose plugins highlight code, for a block that reads the editor's
// highlighters (the code block's picker, its painter), and a stub highlighter the core's own
// rows paint with, so they need no grammar engine.
import {
	definePlugin,
	type CodeHighlighter,
	type CodeLanguage,
	type CodeToken
} from '#lib/plugin.js';
import { installPluginList, type PluginError } from '#lib/schema/plugin-unit.js';
import { createEditorContributions } from '#lib/schema/editor-contributions.js';
import { DETACHED_READING } from '#lib/schema/doc-view.js';
import { createEditorActivation, type PluginActivation } from '#lib/schema/plugin-activation.js';
import { createCodePainter } from '#lib/components/blocks/code/code-painter.js';

/** An activation listing one plugin per highlighter, in order; `errors` collects what they report. */
export function activationWith(...highlighters: { name: string; code: CodeHighlighter }[]): {
	activation: PluginActivation;
	errors: PluginError[];
} {
	const errors: PluginError[] = [];
	const report = (error: PluginError) => errors.push(error);
	const contributions = createEditorContributions({
		editorFor: () => undefined,
		report,
		blocksAround: () => ({ blocks: [] }),
		blockOf: (node) => DETACHED_READING.blockOf(node, null),
		clipboardBlocks: () => (node) => DETACHED_READING.blockOf(node, null)
	});
	const plugins = highlighters.map(({ name, code }) =>
		definePlugin({ name, version: '1.0.0', editor: '*', contributes: () => ({ code }) })
	);
	const units = contributions.read(installPluginList(plugins, report));
	const activation = createEditorActivation(
		units.map((unit) => unit.name),
		contributions
	);
	return { activation, errors };
}

/** An activation whose one plugin lists `languages` and paints them all plain. */
export function activationHighlighting(languages: readonly CodeLanguage[]): PluginActivation {
	return activationWith({
		name: 'stub-highlighter',
		code: { languages: () => languages, highlight: () => null }
	}).activation;
}

/** A painter over `activation` that never repaints, for a fragment drawn once. */
export const painterOver = (activation: PluginActivation) =>
	createCodePainter(
		() => activation,
		() => {}
	);

// `const` and `let`, and template literals with each `${…}` nested inside: enough for nested runs
// and runs that cross line endings, CRLF included.
const STUB_RUN = /(?<keyword>\b(?:const|let)\b)|(?<string>`[^`]*`)/g;

/** Highlights `javascript` (alias `js`) synchronously with the core's own `code-tok-*` classes. */
export const stubHighlighter: CodeHighlighter = {
	languages: () => [{ name: 'javascript', aliases: ['js'] }],
	highlight(body) {
		const tokens: CodeToken[] = [];
		for (const run of body.matchAll(STUB_RUN)) {
			const from = run.index;
			const to = from + run[0].length;
			if (run.groups?.keyword) {
				tokens.push({ from, to, class: 'code-tok-keyword' });
				continue;
			}
			tokens.push({ from, to, class: 'code-tok-string' });
			for (const subst of run[0].matchAll(/\$\{[^}]*\}/g)) {
				const at = from + subst.index;
				tokens.push({ from: at, to: at + subst[0].length, class: 'code-tok-subst' });
			}
		}
		return tokens;
	}
};

/** A painter that highlights `javascript` through {@link stubHighlighter}. */
export const stubPainter = () =>
	painterOver(activationWith({ name: 'stub', code: stubHighlighter }).activation);
