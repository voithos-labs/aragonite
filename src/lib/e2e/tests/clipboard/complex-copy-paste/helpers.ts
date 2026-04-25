import { EditorPage } from '../../../editor-page';

export async function waitForClipboardContains(
	editor: EditorPage,
	expected: string,
	timeout = 2000
) {
	await editor.page.waitForFunction(
		async (e) => (await navigator.clipboard.readText()).includes(e),
		expected,
		{ timeout, polling: 32 }
	);
}

// DEFAULT_CONTENT CST paths:
// [0]="# Heading 1"  [1]="## Heading 2"  [2]="### Heading 3"
// [3]=paragraph (bold/italic/strikethrough/code)  [4]=paragraph (link)
// [5]=thematic break  [6]=blockquote ([6,0],[6,1])
// [7]=unordered list ([7,0,0],[7,1,0],[7,1,1,0,0],[7,2,0])
// [8]=ordered list ([8,0,0],[8,1,0],[8,2,0])
// [9]=code block  [10]="A final paragraph."
