/**
 * Support helpers for the browser-backed editor harness proof of concept.
 */
import {
    createCollapsedInputHarnessTextSelection,
    createInputHarnessNodeSelection,
    findFirstInputHarnessBlockByRole,
    type InputHarnessBeforeInputIntent,
    type InputHarnessDocument,
    type InputHarnessSelection,
    type ViewProjectionBlockDescriptor,
    type ViewProjectionInlineRun,
} from "$lib/editor";

export type EditorBrowserHarnessPreset = "paragraph" | "heading" | "listItem" | "fencedCode" | "image";

export function buildEditorBrowserHarnessSelectionPreset(
    document: InputHarnessDocument,
    preset: EditorBrowserHarnessPreset
): InputHarnessSelection | null {
    switch (preset) {
        case "paragraph": {
            const block = findFirstInputHarnessBlockByRole(document, "paragraph");
            return block ? createCollapsedInputHarnessTextSelection(document, block.key, 12) : null;
        }
        case "heading": {
            const block = findFirstInputHarnessBlockByRole(document, "heading");
            return block ? createCollapsedInputHarnessTextSelection(document, block.key, 7) : null;
        }
        case "listItem": {
            const block = findFirstInputHarnessBlockByRole(document, "listItem");
            return block ? createCollapsedInputHarnessTextSelection(document, block.key, 5) : null;
        }
        case "fencedCode": {
            const block = findFirstInputHarnessBlockByRole(document, "fencedCode");
            return block
                ? createCollapsedInputHarnessTextSelection(document, block.key, Math.max(0, block.textLength - 1))
                : null;
        }
        case "image": {
            const imagePart = document.blocks.flatMap((block) => block.parts).find((part) => part.kind === "atom");
            return imagePart ? createInputHarnessNodeSelection(document, imagePart.key) : null;
        }
    }
}

export function readEditorBrowserHarnessBeforeInputIntent(event: InputEvent): InputHarnessBeforeInputIntent | null {
    switch (event.inputType) {
        case "insertText":
            return {
                inputType: "insertText",
                data: event.data ?? "",
            };
        case "insertFromPaste":
            return {
                inputType: "insertFromPaste",
                data: event.dataTransfer?.getData("text/plain") ?? event.data ?? "",
            };
        case "insertParagraph":
            return { inputType: "insertParagraph" };
        case "insertLineBreak":
            return { inputType: "insertLineBreak" };
        case "deleteContentBackward":
            return { inputType: "deleteContentBackward" };
        case "deleteContentForward":
            return { inputType: "deleteContentForward" };
        default:
            return null;
    }
}

export function describeEditorBrowserHarnessBlockChrome(block: ViewProjectionBlockDescriptor): string {
    switch (block.role) {
        case "heading":
            return `${"#".repeat(block.metadata.headingLevel ?? 1)} `;
        case "listItem":
            if (block.metadata.taskItem) {
                return `${block.metadata.listMarker ?? "-"} [${block.metadata.taskChecked ? "x" : " "}] `;
            }
            return `${block.metadata.listMarker ?? "-"} `;
        case "blockquote":
            return "> ";
        default:
            return "";
    }
}

export function buildEditorBrowserHarnessRunClass(
    run: ViewProjectionInlineRun,
    selection: InputHarnessSelection | null
): string {
    return [
        run.atomic ? "editor-browser-harness__run--atom" : "",
        run.atomic && selection?.kind === "node" && selection.selectedAtomKey === run.partKey
            ? "editor-browser-harness__run--selected"
            : "",
        run.marks.includes("strong") ? "editor-browser-harness__run--strong" : "",
        run.marks.includes("emphasis") ? "editor-browser-harness__run--emphasis" : "",
        run.marks.includes("strikethrough") ? "editor-browser-harness__run--strike" : "",
        run.marks.includes("inlineCode") ? "editor-browser-harness__run--code" : "",
        run.marks.includes("link") || run.marks.includes("autolink") ? "editor-browser-harness__run--link" : "",
    ]
        .filter(Boolean)
        .join(" ");
}
