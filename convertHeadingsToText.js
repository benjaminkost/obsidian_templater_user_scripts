/**
 * Templater User Script: convertHeadingsToText
 *
 * Converts all markdown headings from level 4 and below (####, #####, ######)
 * into normal plain text across the active note or selected text.
 *
 * Examples:
 *   #### Unterthema           -> Unterthema
 *   ##### Detailpunkt          -> Detailpunkt
 *   ###### Feine Gliederung    -> Feine Gliederung
 *   ### Wichtiges Thema (H3)   -> ### Wichtiges Thema (H3) [unaltered]
 *
 * Features:
 *   - Preserves YAML frontmatter at the top of the file.
 *   - Protects code blocks (``` or ~~~) so code comments like '#### comment' remain intact.
 *   - Strips optional trailing ATX hashes (e.g. '#### Section ####' -> 'Section').
 *   - Works on selected text if text is highlighted in the editor.
 *   - Works on the entire active file if nothing is selected.
 *   - Can be used synchronously/directly on a string.
 *   - Supports options: minLevel (default 4), maxLevel (default 6), asBold (default false).
 *
 * Usage:
 *   <%* await tp.user.convertHeadingsToText(tp) -%>
 *
 * Or programmatically:
 *   await tp.user.convertHeadingsToText(tp, { minLevel: 4, targetFile: "Path/to/Note.md" });
 */

/**
 * Removes markdown heading syntax for headings at or below minLevel.
 *
 * @param {string} content - Input markdown text.
 * @param {object} options - Options { minLevel: 4, maxLevel: 6, asBold: false }.
 * @returns {{ text: string, count: number }} Resulting text and count of converted headings.
 */
function convertHeadingsToTextInText(content, options = {}) {
    if (!content) return { text: "", count: 0 };

    const minLevel = options.minLevel !== undefined ? options.minLevel : 4;
    const maxLevel = options.maxLevel !== undefined ? options.maxLevel : 6;
    const asBold = options.asBold || false;

    // Preserve frontmatter block at the beginning of the file (--- ... ---)
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
    const frontmatter = fmMatch ? fmMatch[0] : "";
    const body = fmMatch ? content.slice(frontmatter.length) : content;

    let count = 0;
    const lines = body.split(/\r?\n/);
    const newLines = [];
    let inFence = false;

    // Matches headings with minLevel to maxLevel leading hashes (e.g. ####, #####, ######)
    const headingRegex = new RegExp(`^[ \\t]{0,3}(#{${minLevel},${maxLevel}})(?:[ \\t]+(.*)|[ \\t]*)$`);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Do not touch lines inside code blocks (``` or ~~~)
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            newLines.push(line);
            continue;
        }
        if (inFence) {
            newLines.push(line);
            continue;
        }

        const match = line.match(headingRegex);
        if (match) {
            count++;
            // Extract heading text and strip optional trailing ATX hashes (e.g. '#### Title ####')
            let headingContent = (match[2] || "").replace(/[ \t]+#+[ \t]*$/, "");

            if (asBold && headingContent.trim().length > 0) {
                newLines.push(`**${headingContent.trim()}**`);
            } else {
                newLines.push(headingContent);
            }
            continue;
        }

        newLines.push(line);
    }

    return {
        text: frontmatter + newLines.join("\n"),
        count
    };
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
 *
 * Supports:
 *   - Direct string invocation: tp.user.convertHeadingsToText("#### Heading\nText") (synchronous)
 *   - Interactive Templater usage: await tp.user.convertHeadingsToText(tp, options) (Promise)
 */
function main(tp, options = {}) {
    // Direct string invocation support: tp.user.convertHeadingsToText("...")
    if (typeof tp === "string") {
        const res = convertHeadingsToTextInText(tp, typeof options === "object" ? options : {});
        return res.text;
    }

    // Direct invocation with text option: tp.user.convertHeadingsToText(tp, { text: "..." })
    if (options && typeof options.text === "string") {
        const res = convertHeadingsToTextInText(options.text, options);
        return res.text;
    }

    return (async () => {
        const app = (tp && tp.app) || window.app;
        if (!app) {
            const res = convertHeadingsToTextInText(String(options || ""));
            return res.text;
        }

        // Check if text is highlighted in the active editor
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

        // If text is selected in the editor, convert only within the selection
        if (selectedText && selectedText.trim().length > 0) {
            const { text: newSelection, count } = convertHeadingsToTextInText(selectedText, options);
            if (count === 0) {
                showNotice("ℹ️ Keine Überschriften ab #### in der Auswahl gefunden.");
                return selectedText;
            }

            if (activeEditor && typeof activeEditor.replaceSelection === "function") {
                activeEditor.replaceSelection(newSelection);
            }
            showNotice(`✅ ${count} Überschrift${count === 1 ? "" : "en"} (ab ####) in der Auswahl zu normalem Text umgewandelt!`);
            return newSelection;
        }

        // Identify target file
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
        const { text: newContent, count } = convertHeadingsToTextInText(content, options);

        if (count === 0) {
            showNotice("ℹ️ Keine Überschriften ab #### in der Notiz gefunden.");
            return "";
        }

        await app.vault.modify(targetFile, newContent);
        showNotice(`✅ ${count} Überschrift${count === 1 ? "" : "en"} (ab ####) erfolgreich zu normalem Text umgewandelt!`);
        return "";
    })();
}

main.convertHeadingsToTextInText = convertHeadingsToTextInText;

module.exports = main;
