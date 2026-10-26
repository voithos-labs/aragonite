/**
 * An e2e spec drives the browser through the shared helpers, each supplying what a raw call skips:
 * the IME driver (G4.49), the clipboard helper (G4.212), `gotoReady` and `reloadReady`, the mode
 * switch that waits (G4.133), the Firefox click-run, insert and in-place helpers (G4.228), the
 * platform's own key spelling (G4.226), `endTypingBatch` (G4.232) and `waitForImagesDecoded`.
 * Probe text is spelled in pieces, since this file is scanned too.
 */
import { it, expect } from 'vitest';
import { collectFiles, readSource } from '../../test/invariants/lint/scan-source';
import { describeManifests, notUnder } from '../../test/invariants/lint/file-rule';
import type { SourceFile } from '../../test/invariants/lint/scan-source';

const files = collectFiles('src/lib/e2e', { extensions: ['.ts'] }).map(readSource);

const IME_DRIVER = 'src/lib/e2e/simulation/ime.ts';
const CLIPBOARD_HELPER = 'src/lib/e2e/clipboard-arm.ts';
const NAVIGATION_HELPER = 'src/lib/e2e/goto-ready.ts';
const BRIDGE_HOME = 'src/lib/e2e/editor-page.ts';
const CONTROL_HOME = 'src/lib/e2e/mode-switch.ts';
const MULTI_CLICK_HELPER = 'src/lib/e2e/multi-click.ts';
const INSERT_TEXT_HELPER = 'src/lib/e2e/insert-text.ts';
const PLATFORM_KEYS = 'src/lib/e2e/platform-keys.ts';
const EDGE_CHORDS_SPEC = 'src/lib/e2e/tests/keyboard-navigation/edge-chords.spec.ts';
const IN_PLACE_HELPER = 'src/lib/e2e/click-in-place.ts';
const TYPING_BATCH_HELPER = 'src/lib/e2e/typing-batch.ts';
const TYPING_PAUSE_SPEC = 'src/lib/e2e/tests/undo-typing-pause.spec.ts';
const IMAGE_WAIT = 'src/lib/e2e/tests/blocks/image/helpers.ts';

const COMPOSITION = 'Composition';
const COMPOSING = 'Composing';
const clip = 'navigator.' + 'clipboard';
const press = (chord: string) => `await page.keyboard.press('${chord}');`;
const pasteChord = (modifiers: string, key = 'v') => press(`${modifiers}+${key}`);
const nav = (receiver: string, call: string) => `await ${receiver}.${call}`;
const bridge = '(window as any).__' + 'test';
const setter = 'setPresentation' + 'Mode';
const dbl = 'dbl' + 'click';
const count = 'click' + 'Count';
const insert = 'insert' + 'Text';
const home = 'Ho' + 'me';
const end = 'E' + 'nd';
const ctrl = 'Contr' + 'ol';

// A shared helper, which can't know whether its caller measures the scroll, or a spec that reads or
// sets it (the VR specs all do, some through their helpers).
const SCROLL_READ =
	/\bscroll(?:Top|Left|X|Y|Height)\b|\b(?:scrollEditorTo|progressiveScrollTo|scrollIntoView|toBeInViewport)\b|\brects\.scrollTo\b/;
const HOLDS_SCROLL = (file: SourceFile): boolean =>
	!file.relPath.startsWith('src/lib/e2e/lint/') &&
	!file.relPath.startsWith('src/lib/e2e/simulation/') &&
	(!file.relPath.endsWith('.spec.ts') ||
		file.relPath.startsWith('src/lib/e2e/tests/perf/') ||
		SCROLL_READ.test(file.code));
const act = (verb: string) => `.${verb}(`;

// No page object here has a reload or history method, and `EditorPage.goto` takes a query, not a route.
const RAW_GOTO = /(?<![\w$])page\s*\.\s*goto\s*\(|\.\s*goto\s*\(\s*['"`](?:\/|https?:)/;
const RAW_HISTORY = /\.\s*(?:reload|goBack|goForward)\s*\(/;

const SCANNED_SPECS = notUnder('src/lib/e2e/lint/');
const wait = (ms: string) => `await page.waitFor${'Timeout'}(${ms});`;
const lines = (...parts: string[]) => parts.join('\n');
const FIXED_WAIT = /\bwaitForTimeout\s*\(/;
const UNDO_STEP = /\.\s*(?:undo|redo)\s*\(|\+[zZ]['"`]/;
const NAMES_UNDO = /\bundo|debounce|typing (?:pause|batch)/i;
// A fixed wait whose own line names undo grouping, or that sits within three lines of an undo.
function waitsOutTypingPause(file: SourceFile): boolean {
	const code = file.code.split('\n');
	const text = file.text.split('\n');
	return code.some(
		(line, i) =>
			FIXED_WAIT.test(line) &&
			(NAMES_UNDO.test(text[i]) ||
				code.slice(Math.max(0, i - 3), i + 4).some((near) => UNDO_STEP.test(near)))
	);
}

describeManifests(
	[
		{
			id: 'G4.49 e2e composition rides the shared IME driver, the only file building the events',
			// Every way around the driver: the event itself, the input event carrying its bytes, and a
			// key event claiming to sit inside a composition.
			matches: new RegExp(
				`new\\s+${COMPOSITION}Event\\s*\\(|insert${COMPOSITION}Text|is${COMPOSING}\\s*:\\s*true`
			),
			declared: {
				[IME_DRIVER]: 'the branch for WebKit and Firefox, which have no CDP to compose through'
			},
			reason:
				'drive the composition through attachIme (e2e/simulation/ime.ts): a synthetic event skips the browser composition window',
			hits: [
				`new ${COMPOSITION}Event('compositionstart')`,
				`{ inputType: 'insert${COMPOSITION}Text' }`,
				`new KeyboardEvent('keydown', { key: 'Enter', is${COMPOSING}: true })`
			],
			misses: [
				'await ime.compose("か");',
				"await ime.press('Enter');",
				`e.is${COMPOSING} === false`
			]
		},
		{
			id: 'G4.49 the CDP branch is where Chromium composition lives',
			matches: new RegExp(`Input\\.ime${'Set'}${COMPOSITION}`),
			declared: { [IME_DRIVER]: 'the Chromium branch' },
			reason: `Chromium composes through the CDP branch of ${IME_DRIVER}`,
			hits: [`await cdp.send('Input.ime${'Set'}${COMPOSITION}', params);`],
			misses: [`await cdp.send('Input.insertText', params);`]
		},
		// Miss-analysis: specs drove the page clipboard and the paste chord themselves, unseen until
		// WebKit ran them. A chord joined from strings (`mod + '+v'`) still gets past.
		{
			id: 'G4.212 e2e clipboard access rides the shared clipboard helper',
			matches: /\bnavigator\s*\??\.\s*clipboard\b/,
			declared: { [CLIPBOARD_HELPER]: 'both branches, and the read a spec can hold' },
			reason: `seed, read and paste through the clipboard helper (${CLIPBOARD_HELPER}): WebKit refuses a page's own clipboard calls`,
			hits: [
				`await page.evaluate(() => ${clip}.writeText('x'));`,
				`const items = await ${clip}.read();`,
				`${clip}.readText = () => held;`,
				`await navigator?.${'clipboard'}.readText();`
			],
			misses: ["await editor.seedClipboard('x');", "await editor.readClipboard('text/html');"]
		},
		{
			id: 'G4.212 e2e pastes ride the shared clipboard helper',
			// The closing brace is a template whose modifier is a variable.
			matches: /(?:['"`](?:ControlOrMeta|Control|Meta)|\})\+(?:Shift\+)?(?:v|V|KeyV)['"`]/,
			declared: { [CLIPBOARD_HELPER]: 'the Chromium branch, which pastes through the keystroke' },
			reason: `paste with editor.paste() or the clipboard helper (${CLIPBOARD_HELPER}): WebKit's paste keystroke can't read what a spec seeds`,
			hits: [
				pasteChord('ControlOrMeta'),
				pasteChord('ControlOrMeta', 'KeyV'),
				pasteChord(`${ctrl}+Shift`, 'V'),
				`ctx.page.keyboard.press("Meta+${'v'}")`,
				'await page.keyboard.press(`${mod}' + '+v`);'
			],
			misses: [
				press('ControlOrMeta+c'),
				press('ControlOrMeta+x'),
				"await page.keyboard.type('v');",
				'`${prefix}' + '+value`'
			]
		},
		// Miss-analysis: each spec wrote its own wait and no scan held them to one, so one waited on
		// markup. A `goto(variable)` on a page spelled otherwise still gets past the matcher.
		{
			id: 'every e2e page navigation waits for the route to hydrate',
			matches: RAW_GOTO,
			declared: { [NAVIGATION_HELPER]: 'gotoReady, which waits for the readiness global' },
			reason: `navigate with gotoReady (${NAVIGATION_HELPER}): a raw navigation can act before hydration`,
			hits: [
				nav('page', "goto('/')"),
				nav('this.page', 'goto(url)'),
				nav('homepage', "goto('/')"),
				nav('p', "goto('/x')"),
				nav('popup', 'goto(`http://localhost/`)')
			],
			misses: [
				nav('editor', "goto('?presentationMode=live')"),
				nav('editor', "goto('')"),
				nav('ep', 'goto(query)'),
				"await gotoReady(page, '/test/syntax')"
			]
		},
		{
			id: 'every e2e reload or history step waits for the route to hydrate',
			matches: RAW_HISTORY,
			declared: { [NAVIGATION_HELPER]: 'reloadReady, which waits for the readiness global' },
			reason: `reload with reloadReady (${NAVIGATION_HELPER}): a raw reload can act before hydration`,
			hits: [nav('editor.page', 'reload()'), nav('page', 'goBack()'), nav('second', 'reload()')],
			misses: ['await reloadReady(page)']
		},
		// Miss-analysis: specs made click runs with the driver's click count, which Firefox over BiDi
		// drops, unseen until real Firefox ran them. A count spelled through a variable still gets past.
		{
			id: 'every e2e double or triple click rides the shared multi-click helper',
			matches: /\.\s*dblclick\s*\(|\bclickCount\b/,
			declared: { [MULTI_CLICK_HELPER]: "the driver's click count, or on Firefox the written one" },
			reason: `click a run with multiClick (${MULTI_CLICK_HELPER}): Firefox over BiDi drops the click count`,
			hits: [
				`await page.mouse.${dbl}(at.x, at.y);`,
				`await widget.${dbl}();`,
				`await page.mouse.click(x, y, { ${count}: 3 });`,
				`await page.mouse.down({ ${count} });`
			],
			misses: ['await multiClick(page, at, 2);', 'await page.mouse.click(x, y);', `on${dbl}={open}`]
		},
		// Miss-analysis: Playwright's Firefox insert fires a bare input no browser sends, and the
		// specs that typed through it went red only on real Firefox.
		{
			id: 'every e2e keyless text insert rides the shared insert helper',
			matches: /\.\s*keyboard\s*\.\s*insertText\s*\(/,
			declared: { [INSERT_TEXT_HELPER]: 'the driver insert, or on Firefox the beforeinput first' },
			reason: `insert keyless text with insertText (${INSERT_TEXT_HELPER}): Firefox over BiDi fakes it with a bare input event`,
			hits: [
				`await page.keyboard.${insert}('x');`,
				`(e) => e.page.keyboard
	.${insert}(ch)`
			],
			misses: [`await ${insert}(page, 'x');`, "await page.keyboard.type('x');"]
		},
		// Miss-analysis: specs pressed Home and End, which scroll the page on macOS, and no run on
		// macOS gated, so 140 files went red there before any spec spelled the platform's chord.
		{
			id: 'G4.226 every e2e caret-edge key is the platform-keys chord',
			matches:
				/(['"`])(?:(?:[A-Za-z]+\+)*(?:Home|End)|(?:Shift\+)?Meta\+(?:Shift\+)?Arrow(?:Left|Right|Up|Down))\1/,
			declared: {
				[PLATFORM_KEYS]: 'edgeKey and extendKey, the one spelling per platform',
				[EDGE_CHORDS_SPEC]:
					"sends both platforms' literal chords on every engine, so the Cmd+Arrow reading runs on every Linux push"
			},
			reason: `press edgeKey or extendKey (${PLATFORM_KEYS}): on macOS Home and End scroll the page`,
			hits: [
				press(end),
				press(`Shift+${home}`),
				press(`ControlOrMeta+Shift+${end}`),
				`const rows = [['${home}', 'abc']];`,
				`function at(key: '${home}' | 'x') {}`,
				press(`Meta+Arrow${'Left'}`)
			],
			misses: [
				"await page.keyboard.press(edgeKey('lineEnd'));",
				`await page.keyboard.type('The ${end}');`,
				`const name = 'Week${end}';`
			]
		},
		{
			id: 'G4.226 every e2e chord names the platform modifier, never Ctrl alone',
			matches: /(['"`])Control(?:\+[^'"`\n]*)?\1/,
			declared: {
				[PLATFORM_KEYS]: 'the word and copy modifiers, spelled per platform',
				'src/lib/e2e/selection-drag.ts':
					'turns the copy modifier the helper named into the drop event',
				[EDGE_CHORDS_SPEC]: 'holds Ctrl+Arrow to word motion on Windows and Linux'
			},
			reason: `press ControlOrMeta, or WORD_MODIFIER and COPY_DRAG_MODIFIERS (${PLATFORM_KEYS}): on macOS Ctrl+click is a right-click and Ctrl+A goes to the line's start`,
			hits: [
				press(`${ctrl}+a`),
				`await link.click({ modifiers: ['${ctrl}'] });`,
				`await page.keyboard.down('${ctrl}');`
			],
			misses: [
				press('ControlOrMeta+a'),
				"await link.click({ modifiers: ['ControlOrMeta'] });",
				"await page.keyboard.down('ControlOrMeta');"
			]
		},
		// Miss-analysis: a wall-clock wait split undo steps on a quiet runner and joined them on a
		// loaded one. A wait more than three lines from the undo, with no comment, still gets past.
		{
			id: 'G4.232 a fixed wait never decides where undo steps split',
			population: SCANNED_SPECS,
			matches: waitsOutTypingPause,
			declared: {
				'src/lib/e2e/tests/blocks/image/selection-history.spec.ts':
					'waits after an undo or redo has landed, for a stale selection that drops the caret late'
			},
			reason: `end the typing batch with endTypingBatch (${TYPING_BATCH_HELPER}): every navigation holds it, so a wait splits nothing, and the page's own timer can run late`,
			hits: [
				`${wait('300')} // past the 250ms undo debounce`,
				lines(wait('700'), '', `await editor.${'undo'}();`),
				lines(wait('150'), press('ControlOrMeta+z'))
			],
			misses: [
				`${wait('150')} // checking nothing happens`,
				lines('await editor.endTypingBatch();', `await editor.${'undo'}();`),
				lines(wait('60'), 'await a();', 'await b();', 'await c();', `await editor.${'undo'}();`)
			]
		},
		{
			id: 'G4.232 only the typing-batch helper and its spec reach the real pause or the page handle',
			population: SCANNED_SPECS,
			matches: new RegExp(
				`\\b(?:UNDO_${'DEBOUNCE'}_MS|PAST_TYPING_${'PAUSE'}_MS|waitForUndo${'Batch'}Flush|release${'Typing'}Pause|__typing${'Batches'})\\b`
			),
			declared: {
				[TYPING_BATCH_HELPER]:
					'the page handle, and releaseTypingPause, which hands the batch back to the real timer',
				[TYPING_PAUSE_SPEC]: 'the one row that runs the real pause'
			},
			reason: `split undo steps with endTypingBatch (${TYPING_BATCH_HELPER}); the real pause runs only in ${TYPING_PAUSE_SPEC}`,
			hits: [
				`await editor.waitForUndo${'Batch'}Flush();`,
				`await page.clock.runFor(PAST_TYPING_${'PAUSE'}_MS);`,
				`import { UNDO_${'DEBOUNCE'}_MS } from '../editor-actions/commit/text-batch';`,
				`await release${'Typing'}Pause(page);`,
				`await page.evaluate(() => (window as any).__typing${'Batches'}.release());`
			],
			misses: ['await editor.endTypingBatch();', 'await page.clock.runFor(OCCURRENCE_PAUSE_MS);']
		},
		// Miss-analysis: three scroll rows went red on Firefox only, read as the editor scrolling,
		// for a scroll the driver made. A locator held in a variable named `mouse` still gets past.
		{
			id: 'G4.228 a spec that reads the scroll, and every shared helper, acts on a locator in place',
			population: HOLDS_SCROLL,
			matches:
				/(?<!\b(?:mouse|touchscreen)\s*)\.\s*(?:click|hover|tap|dragTo|scrollIntoViewIfNeeded)\s*\(/,
			declared: {
				'src/lib/e2e/tests/decorations/mark-hover.spec.ts':
					'clicks the host’s toggle from page script, so no driver moves the pointer',
				'src/lib/e2e/tests/perf/vr-header-reveal-race.spec.ts':
					'clicks the header toggle from page script, inside the scroll it races',
				'src/lib/e2e/tests/perf/vr-reveal-anchor.spec.ts':
					'clicks a contents entry from page script, inside the scroll it races'
			},
			reason: `click, hover or scroll a locator with ${IN_PLACE_HELPER}: Firefox over BiDi scrolls every locator action's target to the middle of the screen first`,
			hits: [
				`await cell.${'click'}();`,
				`await row${act('hover')});`,
				`await target${act('click')}{ position: { x, y } });`,
				`await page.getByTestId('edit')
	${act('click')});`,
				`await el${act('scrollIntoViewIfNeeded')});`,
				{ relPath: 'src/lib/e2e/tests/perf/vr-x.spec.ts', code: `await cell${act('click')});` },
				{
					relPath: 'src/lib/e2e/tests/x.spec.ts',
					code: `await progressiveScrollTo(editor, 900);\nawait cell${act('click')});`
				},
				{
					relPath: 'src/lib/e2e/tests/x.spec.ts',
					code: `await page.evaluate(() => __test.rects.scrollTo([9]));\nawait cell${act('click')});`
				},
				{
					relPath: 'src/lib/e2e/tests/x.spec.ts',
					code: `const x = await el.evaluate((e) => e.scrollLeft);\nawait cell${act('click')});`
				},
				{
					relPath: 'src/lib/e2e/tests/x.spec.ts',
					code: `await cell${act('click')});\nawait expect(row).toBeInViewport();`
				}
			],
			misses: [
				'await clickInPlace(cell);',
				`await page.mouse${act('click')}x, y);`,
				`await page.mouse${act('move')}x, y);`,
				`await page.touchscreen${act('tap')}x, y);`,
				{ relPath: 'src/lib/e2e/tests/x.spec.ts', code: `await cell${act('click')});` },
				{
					relPath: 'src/lib/e2e/tests/x.spec.ts',
					code: `expect(doc.scrollWidth).toBe(390);\nawait chip${act('tap')});`
				}
			]
		},
		// Miss-analysis: two selection specs stayed green with the harness dropping live mode to
		// source. An alias of the bridge held across statements still gets past the matcher.
		{
			id: 'G4.133 every e2e mode switch through the bridge waits for the mode to apply',
			matches:
				/\b__test\b[^;]*?\bsetPresentationMode\b|\bsetPresentationMode\b[^;]*?=\s*[^;]*?\b__test\b/,
			declared: { [BRIDGE_HOME]: 'EditorPage.setPresentationMode, which waits for the mode' },
			reason: `call EditorPage.setPresentationMode (${BRIDGE_HOME}), which waits for the mode to apply`,
			hits: [
				`await page.evaluate(() => ${bridge}.${setter}('live'));`,
				`page.evaluate((m) =>\n\t${bridge}\n\t\t.${setter}(m), mode);`,
				`const { ${setter} } = ${bridge};`,
				`${bridge}['${setter}']('reading');`
			],
			misses: [
				`await ep.${setter}('live');`,
				`await page.evaluate(() => ${bridge}.getSource());\nawait ep.${setter}('live');`
			]
		},
		{
			id: 'G4.133 every e2e mode toggle or mode button click waits for the mode to apply',
			// The test route's header checkboxes, and the showcase's mode buttons.
			matches: /\b(?:presentation|live|preview-block|preview-inline)-toggle\b|\bshowcase-mode\b/,
			declared: {
				[CONTROL_HOME]: 'clickModeToggle and clickModeButton, which wait for the mode',
				'src/lib/e2e/tests/keybinding-multi-editor.spec.ts':
					'focuses the reading toggle without clicking it, so the mode never changes',
				'src/lib/e2e/tests/mobile-showcase.spec.ts':
					'taps a mode button on a phone layout and checks the mode itself'
			},
			reason: `click it with clickModeToggle or clickModeButton (${CONTROL_HOME}), which wait for the mode to apply`,
			hits: [
				`page.getByTestId('live-${'toggle'}')`,
				`['reading', 'presentation-${'toggle'}']`,
				`testid: 'preview-inline-${'toggle'}'`,
				`page.locator('.showcase-${'mode'}[data-mode="live"]')`
			],
			misses: [
				`page.getByTestId('theme-${'toggle'}')`,
				`page.locator('.showcase-${'modes'}')`,
				`await clickModeToggle(page, 'live');`
			]
		},
		// Miss-analysis: specs read `complete` or `naturalWidth` their own ways, both of which pass
		// for a picture whose header parses and whose pixels never decode.
		{
			id: 'every e2e wait for a picture rides the shared decode wait',
			population: SCANNED_SPECS,
			matches: /\.complete\b|\bnatural(?:Width|Height)\b|\.decode\s*\(\s*\)/,
			declared: {
				[IMAGE_WAIT]: 'waitForImagesDecoded, which decodes each picture',
				'src/lib/e2e/carets-showing.ts': 'decodes its own screenshot before reading the pixels',
				[NAVIGATION_HELPER]:
					'waits for a page to stop downloading, decoded or not, before leaving it',
				'src/lib/e2e/tests/blocks/image/image-load-scroll-stability.spec.ts':
					'asserts the picture has not loaded yet',
				'src/lib/e2e/tests/goto-ready.spec.ts': 'asserts a picture is still downloading',
				'src/lib/e2e/tests/perf/vr-nested-growth.spec.ts':
					'waits for the picture to decode or unmount, whichever comes first'
			},
			reason: `wait with waitForImagesDecoded (${IMAGE_WAIT}): \`complete\` and \`naturalWidth\` pass for a picture that never decodes`,
			hits: [
				"await page.waitForFunction(() => document.querySelector('img')?.complete);",
				'imgs.every((img) => img.naturalWidth > 0)',
				'return (img?.naturalHeight ?? 0) > 0;',
				'await img.decode();'
			],
			misses: [
				'await waitForFirstImageLoaded(page);',
				'new TextDecoder().decode(bytes)',
				'expect(row.completed).toBe(true);'
			]
		}
	],
	files
);

it('the navigation helper wraps exactly two gotos and a reload', () => {
	const helper = files.find((file) => file.relPath === NAVIGATION_HELPER);
	const calls = [...(helper?.code ?? '').matchAll(/\.\s*(goto|reload|goBack|goForward)\s*\(/g)];
	expect(calls.map((m) => m[1])).toEqual(['goto', 'goto', 'reload']);
});
