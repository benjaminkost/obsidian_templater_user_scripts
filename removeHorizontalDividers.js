/**
 * Templater User Script: removeHorizontalDividers
 *
 * Deletes all horizontal dividers (lines with '---') from the body of the
 * currently open note, while preserving the YAML frontmatter at the top
 * and any '---' inside code blocks.
 *
 * Usage:
 *   <%* await tp.user.removeHorizontalDividers(tp) -%>
 *
 * Or programmatically:
 *   await tp.user.removeHorizontalDividers(tp, { targetFile: "Path/to/Note.md" });
 */

/**
 * Removes horizontal rule lines (---) from the body of markdown content.
 * Preserves the frontmatter at the beginning and lines inside code blocks.
 *
 * @param {string} content - Full markdown note text.
 * @returns {{ text: string, count: number }} Cleaned content and count of removed dividers.
 */
function removeHorizontalDividersInText(content) {
    // Preserve frontmatter block at the beginning of the file (--- ... ---)
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
    const frontmatter = fmMatch ? fmMatch[0] : "";
    const body = fmMatch ? content.slice(frontmatter.length) : content;

    let count = 0;
    const lines = body.split(/\r?\n/);
    const newLines = [];
    let inFence = false;

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

        // Match horizontal divider lines (3 or more dashes on their own line)
        if (/^[ \t]*-{3,}[ \t]*$/.test(line)) {
            count++;
            // If preceded and followed by empty lines, skip the trailing empty line
            // to avoid leaving multiple consecutive blank lines
            if (
                newLines.length > 0 &&
                newLines[newLines.length - 1].trim() === "" &&
                i + 1 < lines.length &&
                lines[i + 1].trim() === ""
            ) {
                i++;
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

module.exports = async function (tp, options = {}) {
    const app = tp.app || window.app;

    // Determine target file (options.targetFile, options.sourceFile, active file)
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
    } else {
        targetFile = app.workspace.getActiveFile();
    }

    if (!targetFile) {
        new Notice("❌ Keine geöffnete Notiz gefunden!");
        return;
    }

    const content = await app.vault.read(targetFile);
    const { text: newContent, count } = removeHorizontalDividersInText(content);

    if (count === 0) {
        new Notice("ℹ️ Keine horizontalen Trennlinien (---) im Notizinhalt gefunden.");
        return "";
    }

    await app.vault.modify(targetFile, newContent);
    new Notice(`✅ ${count} Trennlinie${count === 1 ? "" : "n"} (---) erfolgreich entfernt!`);
    return "";
}
