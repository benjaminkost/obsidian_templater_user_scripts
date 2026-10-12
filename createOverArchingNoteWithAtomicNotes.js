/**
 * Templater User Script: createOverArchingNoteWithAtomicNotes
 *
 * Works like createAtomicNotes.js (splits the open note into atomic notes based on its headings),
 * with these differences:
 *  - The open note is the overarching note: atomic notes without a parent of their own
 *    (top heading level) get it as "up".
 *  - The text used for the notes is then deleted from the open file
 *    (from the first heading up to "Übungsaufgaben"/"Quellen"/...). In its place,
 *    the section "# Unterthemen" with a Dataview query is inserted.
 *  - Lets the user define up to which heading level (e.g. H1, H2, H3, ...) new notes should be created.
 *    Sub-headings deeper than the chosen level remain inside their parent note's body.
 *
 * Usage:
 *   <%* await tp.user.createOverArchingNoteWithAtomicNotes(tp) -%>
 *
 * Options (passed on to createAtomicNotes):
 *   maxLevel (1-6), templateFile, targetFolder, sourceFile, deleteSourceText, ...
 */

function buildUnterthemenBlock() {
    const fence = "```";
    return [
        "# Unterthemen",
        fence + "dataview",
        "LIST FROM !#aufgaben",
        "WHERE contains(up, [[]]) OR contains(parent, [[]])",
        "SORT file.ctime ASC",
        fence,
        ""
    ].join("\n");
}

module.exports = async function (tp, options = {}) {
    const app = tp.app || window.app;

    if (typeof tp.user?.createAtomicNotes !== "function") {
        new Notice("❌ tp.user.createAtomicNotes wurde nicht gefunden (createAtomicNotes.js im User-Scripts-Ordner?).");
        return;
    }

    // Open file = overarching note
    let openFile = null;
    if (options.sourceFile) {
        openFile = typeof options.sourceFile === "string"
            ? app.vault.getAbstractFileByPath(options.sourceFile)
            : options.sourceFile;
    } else {
        openFile = tp.config?.target_file ?? app.workspace.getActiveFile();
    }
    if (!openFile) {
        new Notice("❌ Keine geöffnete Datei gefunden!");
        return;
    }

    // Ask user for maximum heading level for note creation (if not specified in options)
    let maxLevel = options.maxLevel ?? options.maxHeadingLevel;
    if (maxLevel === undefined && tp.system) {
        const levelChoices = [
            "Alle Ebenen (# bis ######) [Standard]",
            "Ebene 1 (#) - Nur H1",
            "Ebene 2 (##) - Bis H2",
            "Ebene 3 (###) - Bis H3",
            "Ebene 4 (####) - Bis H4",
            "Ebene 5 (#####) - Bis H5"
        ];
        const levelValues = [6, 1, 2, 3, 4, 5];

        const chosen = await tp.system.suggester(
            levelChoices,
            levelValues,
            false,
            "Bis zu welchem Überschriften-Niveau sollen neue Notizen erstellt werden?"
        );

        if (chosen === undefined || chosen === null) {
            new Notice("Abgebrochen: Kein Überschriften-Niveau ausgewählt.");
            return;
        }
        maxLevel = chosen;
    }

    // Create atomic notes; the open note is set as "up" of the top level.
    // "Übungsaufgaben", "Quellen" and "Unterthemen" are not topics and are not split.
    const stopHeadings = options.stopHeadings || ["Übungsaufgaben", "Quellen", "Referenz", "Unterthemen"];
    const result = await tp.user.createAtomicNotes(tp, {
        ...options,
        maxLevel,
        stopHeadings,
        sourceFile: openFile,
        existingTags: [openFile.basename],
        skipPrompt: true
    });

    // createAtomicNotes returns undefined on abort (e.g. no headings)
    if (result === undefined) return;

    const content = (await app.vault.read(openFile)).replace(/\r\n/g, "\n");
    const hasUnterthemen = /^#\s+Unterthemen\s*$/m.test(content);
    const block = buildUnterthemenBlock();
    const deleteSourceText = options.deleteSourceText !== false;

    let newContent;
    if (deleteSourceText) {
        // Remove the used text: from the first heading to the first stop heading
        // (or to the end of the file). Text before the first heading and the metadata are kept.
        const fm = content.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
        const bodyStart = fm ? fm[0].length : 0;
        const body = content.slice(bodyStart);

        let firstIdx = -1;
        let stopIdx = -1;
        const headingRegex = /^(#+)\s+(.*)$/gm;
        let m;
        while ((m = headingRegex.exec(body)) !== null) {
            if (firstIdx === -1) firstIdx = m.index;
            if (stopHeadings.includes(m[2].trim())) {
                stopIdx = m.index;
                break;
            }
        }

        if (firstIdx === -1) return "";
        const endIdx = stopIdx === -1 ? body.length : stopIdx;

        const before = content.slice(0, bodyStart) + body.slice(0, firstIdx);
        const after = body.slice(endIdx);
        const insert = hasUnterthemen ? "" : block + (after ? "\n" : "");
        newContent = before + insert + after;
    } else if (hasUnterthemen) {
        new Notice("ℹ️ Abschnitt '# Unterthemen' ist bereits vorhanden.");
        return "";
    } else {
        // Insert before "# Übungsaufgaben", otherwise before "# Quellen", otherwise at the end
        const anchor = content.match(/^#\s+Übungsaufgaben\s*$/m) || content.match(/^#\s+Quellen\s*$/m);
        if (anchor) {
            newContent = content.slice(0, anchor.index) + block + "\n" + content.slice(anchor.index);
        } else {
            const separator = content.length === 0 ? "" : (content.endsWith("\n") ? "\n" : "\n\n");
            newContent = content + separator + block;
        }
    }

    await app.vault.modify(openFile, newContent);
    new Notice(deleteSourceText
        ? "✅ Text in atomare Notizen überführt und aus der Datei entfernt."
        : "✅ Abschnitt '# Unterthemen' hinzugefügt.");
    return "";
};
