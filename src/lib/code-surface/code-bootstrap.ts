/**
 * Static bootstrap for the 17 starter code-block languages. Called from
 * Editor.svelte onMount; idempotent across multiple editor mounts.
 *
 * Adding a language = one import + one registerLanguage call here.
 */

import { registerLanguage } from './code-languages';

// Tier 1 — the 11 core languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';

// Tier 2 — the 6 additional common languages
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import ruby from 'highlight.js/lib/languages/ruby';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';

let booted = false;

export function bootstrapCodeLanguages(): void {
	if (booted) return;
	booted = true;

	// Tier 1
	registerLanguage('javascript', javascript, ['js']);
	registerLanguage('typescript', typescript, ['ts']);
	registerLanguage('python', python, ['py']);
	registerLanguage('rust', rust, ['rs']);
	registerLanguage('go', go);
	registerLanguage('bash', bash, ['sh', 'shell']);
	registerLanguage('json', json);
	registerLanguage('yaml', yaml, ['yml']);
	registerLanguage('sql', sql);
	registerLanguage('html', xml, ['htm']);
	registerLanguage('css', css);

	// Tier 2
	registerLanguage('java', java);
	registerLanguage('c', c);
	registerLanguage('cpp', cpp, ['c++']);
	registerLanguage('ruby', ruby);
	registerLanguage('markdown', markdown, ['md']);
	registerLanguage('diff', diff);
}

/** Test-only: reset booted flag. */
export function __resetBootForTests(): void {
	booted = false;
}
