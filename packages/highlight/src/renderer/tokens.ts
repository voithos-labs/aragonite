/**
 * highlight.js's output as the editor's tokens: each highlight.js scope becomes a run of the body
 * with the editor theme's `code-tok-*` class, nested as highlight.js nests them. Offsets count the
 * body's own characters, line endings included, so a CRLF body needs no repair.
 */
import type { HLJSApi } from 'highlight.js';
import type { CodeToken } from '@voithos-labs/aragonite/plugin';

const CLASS_OF: Readonly<Record<string, string>> = {
	'hljs-keyword': 'code-tok-keyword',
	'hljs-string': 'code-tok-string',
	'hljs-number': 'code-tok-number',
	'hljs-comment': 'code-tok-comment',
	'hljs-doctag': 'code-tok-comment',
	'hljs-quote': 'code-tok-comment',
	'hljs-type': 'code-tok-type',
	'hljs-class': 'code-tok-type',
	'hljs-name': 'code-tok-type',
	'hljs-selector-tag': 'code-tok-type',
	'hljs-built_in': 'code-tok-function',
	'hljs-function': 'code-tok-function',
	'hljs-title': 'code-tok-function',
	'hljs-variable': 'code-tok-variable',
	'hljs-params': 'code-tok-variable',
	'hljs-template-variable': 'code-tok-variable',
	'hljs-operator': 'code-tok-operator',
	'hljs-punctuation': 'code-tok-punctuation',
	'hljs-tag': 'code-tok-punctuation',
	'hljs-bullet': 'code-tok-punctuation',
	'hljs-meta': 'code-tok-meta',
	'hljs-template-tag': 'code-tok-meta',
	'hljs-literal': 'code-tok-literal',
	'hljs-attr': 'code-tok-attr',
	'hljs-attribute': 'code-tok-attr',
	'hljs-selector-id': 'code-tok-attr',
	'hljs-selector-class': 'code-tok-attr',
	'hljs-selector-pseudo': 'code-tok-attr',
	'hljs-addition': 'code-tok-added',
	'hljs-deletion': 'code-tok-removed',
	'hljs-section': 'code-tok-heading',
	'hljs-link': 'code-tok-link',
	'hljs-regexp': 'code-tok-regexp',
	'hljs-symbol': 'code-tok-symbol',
	'hljs-subst': 'code-tok-subst'
};

// highlight.js writes only these: its scope spans, and the five characters it escapes.
const MARKUP = /<span class="([^"]*)">|<\/span>|&(?:amp|lt|gt|quot|#x27);/g;

/** `body`'s tokens under `language`, a name `hljs` has registered. */
export function tokensOf(hljs: HLJSApi, body: string, language: string): CodeToken[] {
	const html = hljs.highlight(body, { language, ignoreIllegals: true }).value;
	// Listed as each scope opens, so of two over one range the outer comes first and is drawn outside.
	const tokens: { from: number; to: number; class: string }[] = [];
	const open: typeof tokens = [];
	let at = 0;
	let read = 0;
	for (const match of html.matchAll(MARKUP)) {
		at += match.index - read;
		read = match.index + match[0].length;
		if (match[1] !== undefined) {
			const token = {
				from: at,
				to: at,
				class: CLASS_OF[match[1].split(' ')[0]] ?? 'code-tok-unknown'
			};
			tokens.push(token);
			open.push(token);
		} else if (match[0] === '</span>') {
			const token = open.pop();
			if (token) token.to = at;
		} else at += 1;
	}
	return tokens.filter((token) => token.to > token.from);
}
