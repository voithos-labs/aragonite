// The grammars in the package's first load, by highlight.js's own file names; every other grammar
// loads the first time a fence names it. `packages/highlight/scripts/catalog.mjs` reads its imports.
import type { LanguageFn } from 'highlight.js';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';

export const EAGER: Readonly<Record<string, LanguageFn>> = {
	javascript,
	typescript,
	json,
	bash,
	python,
	xml,
	css,
	markdown
};
