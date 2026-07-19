/**
 * Idempotent bootstrap for code-block languages + the fencedCode PasteSurface.
 * Adding a language = one import + one registerLanguage call.
 */

import { registerLanguage } from './code-languages';
import {
	registerPasteSurface,
	__removePasteSurfaceForTests
} from '../../../tree-operations/paste-surfaces';
import { codePasteSurface } from './code-paste-surface';

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

	registerLanguage('javascript', javascript, ['js']);
	registerLanguage('typescript', typescript, ['ts']);
	registerLanguage('python', python, ['py']);
	registerLanguage('rust', rust, ['rs']);
	registerLanguage('go', go);
	registerLanguage('bash', bash, ['sh', 'shell']);
	registerLanguage('json', json);
	registerLanguage('yaml', yaml, ['yml']);
	registerLanguage('sql', sql);
	registerLanguage('html', xml, ['htm']); // hljs 'xml' grammar handles HTML
	registerLanguage('css', css);

	registerLanguage('java', java);
	registerLanguage('c', c);
	registerLanguage('cpp', cpp, ['c++']);
	registerLanguage('ruby', ruby);
	registerLanguage('markdown', markdown, ['md']);
	registerLanguage('diff', diff);

	registerPasteSurface(codePasteSurface);
}

/** Test-only: reset the booted flag and unregister the paste surface, so a
 *  re-bootstrap doesn't hit the register-once duplicate throw. */
export function __resetBootForTests(): void {
	booted = false;
	__removePasteSurfaceForTests(codePasteSurface.kind);
}
