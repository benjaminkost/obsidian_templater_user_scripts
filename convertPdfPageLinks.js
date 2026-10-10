/**
 * Templater User Script: convertPdfPageLinks
 *
 * Converts and normalizes PDF references across a note or highlighted text:
 *   - Escaped PDF links:
 *       \[\[filename.pdf#page=66\]\]  ->  [[filename.pdf#page=66]]
 *       \[\[filename.pdf\]\]           ->  [[filename.pdf]]
 *   - Page references with '> page=...':
 *       filename.pdf > page=10        ->  [[filename.pdf#page=10]]
 *       [[filename.pdf]] > page=10    ->  [[filename.pdf#page=10]]
 *       \[\[filename.pdf\]\] > page=10  ->  [[filename.pdf#page=10]]
 *
 * Usage:
 *   <%* await tp.user.convertPdfPageLinks(tp) -%>
 *
 * Direct string invocation:
 *   <% tp.user.convertPdfPageLinks("\[\[filename.pdf#page=66\]\]") %>
 *
 * Programmatically:
 *   await tp.user.convertPdfPageLinks(tp, { targetFile: "Path/to/Note.md" });
 */

/**
 * Converts text containing PDF links, escaped brackets, and '> page=...' references
 * into standard Obsidian '[[filename.pdf#page=X]]' wikilinks.
 *
 * @param {string} text - The input markdown text.
 * @param {string[]} vaultPdfNames - Optional list of known PDF file names from the vault.
 * @returns {{ text: string, count: number }} The converted text and the number of replacements made.
 */
function convertPdfPageLinksInText(text, vaultPdfNames = []) {
    let result = text;
    let count = 0;

    // 1. Known vault PDF filenames that contain spaces (e.g. "My Document Name.pdf > page=10")
    if (vaultPdfNames && vaultPdfNames.length > 0) {
        const pdfsWithSpaces = vaultPdfNames
            .filter(name => name.toLowerCase().endsWith(".pdf") && name.includes(" "))
            .sort((a, b) => b.length - a.length);

        for (const pdfName of pdfsWithSpaces) {
            const escaped = pdfName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(`(?:(?:\\\\?\\[){2})?(${escaped})(?:(?:\\\\?\\]){2})?\\s*>\\s*page\\s*=\\s*(\\d+)`, "gi");
            result = result.replace(pattern, (match, file, page) => {
                count++;
                return `[[${file}#page=${page}]]`;
            });
        }
    }

    // 2. Bracketed links (escaped or unescaped) with '> page=10':
    //    e.g. [[file.pdf]] > page=10 or \[\[file.pdf\]\] > page=10
    result = result.replace(/(?:\\\[|\[){2}([^\]\r\n]+\.pdf)(?:\\\]|\]){2}\s*>\s*page\s*=\s*(\d+)/gi, (match, file, page) => {
        count++;
        return `[[${file}#page=${page}]]`;
    });

    // 3. Fully escaped bracketed PDF links with or without existing #page anchor or alias:
    //    e.g. \[\[tum_signaltheorie-LectureNotes_Ausgabe_3_Februar_2026.pdf#page=66\]\] -> [[tum_signaltheorie-LectureNotes_Ausgabe_3_Februar_2026.pdf#page=66]]
    //    and  \[\[tum_signaltheorie.pdf\]\] -> [[tum_signaltheorie.pdf]]
    result = result.replace(/\\\[\\\[([^\]\r\n]+\.pdf(?:#[^\]\r\n]+)?(?:\|[^\]\r\n]+)?)\\\]\\\]/gi, (match, link) => {
        count++;
        return `[[${link}]]`;
    });

    // 4. Partially escaped bracketed PDF links:
    //    e.g. \[[file.pdf#page=66\]] or [\\[file.pdf#page=66]\\]
    result = result.replace(/(?:\\\[\[|\[\\\[)([^\]\r\n]+\.pdf(?:#[^\]\r\n]+)?(?:\|[^\]\r\n]+)?)(?:\\\]\]|\]\\\])/gi, (match, link) => {
        count++;
        return `[[${link}]]`;
    });

    // 5. Unbracketed filenames without spaces: tum_EMF_VL_WS2627.pdf > page=10
    result = result.replace(/(?<!\[\[)(?<!\\\[\\\[)([^\s\[\]\(\)<>"'#|*?:]+\.pdf)\s*>\s*page\s*=\s*(\d+)(?!\]\])(?!\\\]\\\])/gi, (match, file, page) => {
        count++;
        return `[[${file}#page=${page}]]`;
    });

    return { text: result, count };
}

function showNotice(msg) {
    if (typeof Notice !== "undefined") {
        new Notice(msg);
    } else {
        console.log(msg);
    }
}

/**
 * Main export function for Templater.
 */
module.exports = function (tp, options = {}) {
    // Direct string invocation support: tp.user.convertPdfPageLinks("...")
    if (typeof tp === "string") {
        const { text } = convertPdfPageLinksInText(tp);
        return text;
    }

    if (options && typeof options.text === "string") {
        const { text } = convertPdfPageLinksInText(options.text);
        return text;
    }

    return (async () => {
        const app = (tp && tp.app) || window.app;
        if (!app) {
            const { text } = convertPdfPageLinksInText(String(options || ""));
            return text;
        }

        // Collect known PDF filenames from vault to resolve filenames with spaces
        let vaultPdfNames = [];
        try {
            if (app.vault && typeof app.vault.getFiles === "function") {
                vaultPdfNames = app.vault.getFiles()
                    .filter(f => f.extension === "pdf")
                    .map(f => f.name);
            }
        } catch (e) {
            vaultPdfNames = [];
        }

        // Check if user has an active editor selection in Obsidian
        let activeEditor = null;
        let selectedText = "";

        try {
            if (tp.file && typeof tp.file.selection === "function") {
                selectedText = tp.file.selection();
            }
        } catch (e) {
            // Fallback to workspace active view
        }

        if (!selectedText && app.workspace) {
            const activeView = (typeof app.workspace.getActiveViewOfType === "function" && tp.obsidian)
                ? app.workspace.getActiveViewOfType(tp.obsidian.MarkdownView)
                : (app.workspace.activeLeaf && app.workspace.activeLeaf.view);
            if (activeView && activeView.editor) {
                activeEditor = activeView.editor;
                if (typeof activeEditor.getSelection === "function") {
                    selectedText = activeEditor.getSelection();
                }
            }
        }

        // If text is selected in the editor, transform only the selection
        if (selectedText && selectedText.trim().length > 0) {
            const { text: newSelection, count } = convertPdfPageLinksInText(selectedText, vaultPdfNames);
            if (count === 0) {
                showNotice("ℹ️ Keine PDF-Seitenverweise in der Auswahl gefunden.");
                return selectedText;
            }

            if (activeEditor && typeof activeEditor.replaceSelection === "function") {
                activeEditor.replaceSelection(newSelection);
            }
            showNotice(`✅ ${count} PDF-Verlinkung${count === 1 ? "" : "en"} in der Auswahl erfolgreich formatiert!`);
            return newSelection;
        }

        // Determine target file
        let targetFile = null;
        if (options.targetFile) {
            targetFile = typeof options.targetFile === "string"
                ? app.vault.getAbstractFileByPath(options.targetFile)
                : options.targetFile;
        } else if (options.sourceFile) {
            targetFile = typeof options.sourceFile === "string"
                ? app.vault.getAbstractFileByPath(options.sourceFile)
                : options.sourceFile;
        } else if (tp.config && tp.config.target_file) {
            targetFile = tp.config.target_file;
        } else if (app.workspace && typeof app.workspace.getActiveFile === "function") {
            targetFile = app.workspace.getActiveFile();
        }

        if (!targetFile) {
            showNotice("❌ Keine geöffnete Notiz gefunden!");
            return "";
        }

        const content = await app.vault.read(targetFile);
        const { text: newContent, count } = convertPdfPageLinksInText(content, vaultPdfNames);

        if (count === 0) {
            showNotice("ℹ️ Keine PDF-Seitenverweise zum Umwandeln gefunden.");
            return "";
        }

        await app.vault.modify(targetFile, newContent);
        showNotice(`✅ ${count} PDF-Verlinkung${count === 1 ? "" : "en"} erfolgreich formatiert!`);
        return "";
    })();
}
