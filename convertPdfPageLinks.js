/**
 * Templater User Script: convertPdfPageLinks
 *
 * Converts occurrences of:
 *   filename.pdf > page=10
 * or
 *   [[filename.pdf]] > page=10
 * into:
 *   [[filename.pdf#page=10]]
 * for all occurrences across a note.
 *
 * Usage:
 *   <%* await tp.user.convertPdfPageLinks(tp) -%>
 *
 * Or programmatically:
 *   await tp.user.convertPdfPageLinks(tp, { targetFile: "Path/to/Note.md" });
 */

/**
 * Converts text containing 'filename.pdf > page=10' into '[[filename.pdf#page=10]]'.
 *
 * @param {string} text - The input markdown text.
 * @param {string[]} vaultPdfNames - Optional list of known PDF file names from the vault to support unbracketed filenames with spaces.
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
            const pattern = new RegExp(`(?:\\[\\[)?(${escaped})(?:\\]\\])?\\s*>\\s*page\\s*=\\s*(\\d+)`, "gi");
            result = result.replace(pattern, (match, file, page) => {
                count++;
                return `[[${file}#page=${page}]]`;
            });
        }
    }

    // 2. Bracketed links with or without spaces: [[File Name.pdf]] > page=10
    result = result.replace(/\[\[([^\]\r\n]+\.pdf)\]\]\s*>\s*page\s*=\s*(\d+)/gi, (match, file, page) => {
        count++;
        return `[[${file}#page=${page}]]`;
    });

    // 3. Unbracketed filenames without spaces: tum_EMF_VL_WS2627.pdf > page=10
    result = result.replace(/(?<!\[\[)([^\s\[\]\(\)<>"'#|*?:]+\.pdf)\s*>\s*page\s*=\s*(\d+)(?!\]\])/gi, (match, file, page) => {
        count++;
        return `[[${file}#page=${page}]]`;
    });

    return { text: result, count };
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

    // Collect known PDF filenames from vault to resolve filenames with spaces
    let vaultPdfNames = [];
    try {
        vaultPdfNames = app.vault.getFiles()
            .filter(f => f.extension === "pdf")
            .map(f => f.name);
    } catch (e) {
        // Vault access fallback if getFiles is not available
        vaultPdfNames = [];
    }

    const content = await app.vault.read(targetFile);
    const { text: newContent, count } = convertPdfPageLinksInText(content, vaultPdfNames);

    if (count === 0) {
        new Notice("ℹ️ Keine PDF-Seitenverweise zum Umwandeln gefunden.");
        return "";
    }

    await app.vault.modify(targetFile, newContent);
    new Notice(`✅ ${count} PDF-Verlinkung${count === 1 ? "" : "en"} erfolgreich formatiert!`);
    return "";
}
