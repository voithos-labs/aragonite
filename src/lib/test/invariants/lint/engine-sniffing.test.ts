/**
 * G4.223: the library names no browser engine in code, outside the debug recorder. An engine bug
 * is fixed where the editor reads or decides, the same way on every engine, never in a branch
 * for one (`docs/design/editor.md` § Browser engines). Platform reads (Mac's Cmd) are fine.
 */

import { describeFileRules, notUnder, under, type FileRule, type Probe } from './file-rule';
import { collectEditorSources, type SourceFile } from './scan-source';
import { SOURCE_DIR } from './source-paths';

const ENGINE_NAME = /(?<![-\w])(?:firefox|gecko|safari|webkit|chromium)(?![-\w])/i;
const ENGINE_TEST = /\bis(?:Firefox|Gecko|Safari|WebKit|Webkit|Chrome|Chromium|Blink|Edge|IE)\b/;
const USER_AGENT_TOKEN = /\b(?:chrome|edg|opr|crios|fxios)\//i;
const SNIFF_API =
	/\buserAgent(?:Data)?\b|\bnavigator\s*[?!]?\.\s*(?:vendor|appVersion)\b|\bInstallTrigger\b|\b(?:window|globalThis|self)\s*[?!]?\.\s*(?:chrome|safari)\b/;

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/** A component's script and markup, its `<style>` blocks blanked: a vendor prefix in CSS is the
 *  browser's own gate, not a branch. */
function scriptCode(file: SourceFile): string {
	if (!file.relPath.endsWith('.svelte')) return file.code;
	return file.code.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, blank);
}

function namesAnEngine(file: SourceFile): boolean {
	const code = scriptCode(file);
	return [ENGINE_NAME, ENGINE_TEST, USER_AGENT_TOKEN, SNIFF_API].some((shape) => shape.test(code));
}

const inLibrary = (code: string): Probe => ({ relPath: `${SOURCE_DIR.library}probe.ts`, code });

const ENGINE_SNIFFING: FileRule = {
	id: 'G4.223 the library names no browser engine in code',
	population: (file) => under(SOURCE_DIR.library)(file) && notUnder(SOURCE_DIR.debug)(file),
	matches: namesAnEngine,
	allowed: {},
	reason:
		'a branch for one engine fixes that engine and hides the rule the others break later: canonicalize at the home that reads or decides (browser/, the keydown), the same way on every engine, and pin it with a row that runs on all three (`docs/design/editor.md` § Browser engines)',
	hits: [
		...[
			'const isFirefox = /firefox/i.test(ua);',
			'if (navigator.userAgent.includes("Gecko")) return;',
			"const engine = navigator.vendor === 'Apple Computer, Inc.';",
			'const brands = navigator.userAgentData?.brands;',
			"if (typeof InstallTrigger !== 'undefined') return;",
			'if (isSafari) placeCaret();',
			'if (isWebKit && !composing) return;',
			'const isChrome = !!window.chrome;',
			'const ua = navigator.userAgent;',
			'const ua = nav.userAgent;',
			'const { userAgent } = navigator;',
			'const blinkish = !!window.chrome;',
			'const blinkish = !!globalThis.chrome;',
			'if (/Firefox/.test(ua)) return;',
			"if ('webkit' in probe) return;",
			"const edge = ua.includes('Edg/');",
			"if (ua.indexOf('Chrome/') >= 0) return;"
		].map(inLibrary),
		{
			relPath: `${SOURCE_DIR.library}probe.svelte`,
			code: '<script>\n\tconst webkit = "webkit";\n</script>'
		}
	],
	misses: [
		...[
			"let blink: 'a' | 'b' = 'a';",
			'if (deps.isHostChrome(node)) return;',
			'const chrome = inner?.top() ?? null;',
			'if (isReservedChrome) return cut;',
			'const mac = navigator.platform.startsWith("Mac");',
			"if (e.ctrlKey || e.metaKey) mods.push('Mod');",
			'// Firefox drops a native insertion right before an inline widget.',
			"el.style.setProperty('-webkit-user-select', 'none');"
		].map(inLibrary),
		{
			relPath: `${SOURCE_DIR.library}probe.svelte`,
			code: '<div></div>\n<style>\n\t.editor::-webkit-scrollbar { width: 8px; }\n</style>'
		},
		{ relPath: `${SOURCE_DIR.debug}probe.ts`, code: 'const ua = navigator.userAgent;' }
	]
};

describeFileRules([ENGINE_SNIFFING], collectEditorSources());
