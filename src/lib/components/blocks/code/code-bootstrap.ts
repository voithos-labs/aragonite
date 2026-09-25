/**
 * Sets up the code-block languages and the fencedCode paste handling; safe to call twice. These
 * are built-ins, so the test reset keeps them. Adding a language is one import plus one
 * `registerBuiltinLanguage` call.
 */

import { registerBuiltinLanguage } from './code-languages';
import { registerPasteSurface } from '../../../tree-operations/paste-surfaces';
import { codePasteSurface } from './code-paste-surface';
import { registerCodeContextActions } from './code-context-actions';

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
import latex from 'highlight.js/lib/languages/latex';

import csharp from 'highlight.js/lib/languages/csharp';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

let booted = false;

export function bootstrapCodeLanguages(): void {
	if (booted) return;
	booted = true;

	registerBuiltinLanguage('javascript', javascript, ['js']);
	registerBuiltinLanguage('typescript', typescript, ['ts']);
	registerBuiltinLanguage('python', python, ['py']);
	registerBuiltinLanguage('rust', rust, ['rs']);
	registerBuiltinLanguage('go', go);
	registerBuiltinLanguage('bash', bash, ['sh', 'shell']);
	registerBuiltinLanguage('json', json);
	registerBuiltinLanguage('yaml', yaml, ['yml']);
	registerBuiltinLanguage('sql', sql);
	registerBuiltinLanguage('html', xml, ['htm']); // hljs 'xml' grammar handles HTML
	registerBuiltinLanguage('css', css);

	registerBuiltinLanguage('java', java);
	registerBuiltinLanguage('c', c);
	registerBuiltinLanguage('cpp', cpp, ['c++']);
	registerBuiltinLanguage('ruby', ruby);
	registerBuiltinLanguage('markdown', markdown, ['md']);
	registerBuiltinLanguage('diff', diff);
	registerBuiltinLanguage('latex', latex, ['tex']);

	registerBuiltinLanguage('csharp', csharp, ['cs', 'c#']);
	registerBuiltinLanguage('kotlin', kotlin, ['kt']);
	registerBuiltinLanguage('swift', swift);
	registerBuiltinLanguage('php', php);
	registerBuiltinLanguage('powershell', powershell, ['ps1']);
	registerBuiltinLanguage('dockerfile', dockerfile, ['docker']);

	registerPasteSurface(codePasteSurface);
	registerCodeContextActions();
}
