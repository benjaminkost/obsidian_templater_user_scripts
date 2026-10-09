/**
 * Templater User Script: createOverArchingNoteWithAtomicNotes
 *
 * Ablauf wie createAtomicNotes.js (Aufteilen der geöffneten Notiz anhand ihrer Überschriften
 * in atomare Notizen), mit Unterschieden:
 *  - Die geöffnete Notiz ist die übergeordnete Notiz: Atomare Notizen ohne eigenen
 *    Elternteil (oberste Überschriftsebene) bekommen sie als "up".
 *  - Der für die Notizen genutzte Text wird danach aus der geöffneten Datei gelöscht
 *    (von der ersten Überschrift bis vor "Übungsaufgaben"/"Quellen"/...). An dieser Stelle
 *    steht anschließend der Abschnitt "# Unterthemen" mit einer Dataview-Abfrage.
 *    Mit deleteSourceText: false bleibt der Text erhalten und der Abschnitt wird nur ergänzt.
 *
 * Verwendung:
 *   <%* await tp.user.createOverArchingNoteWithAtomicNotes(tp) -%>
 *
 * Optionen (werden an createAtomicNotes weitergereicht):
 *   templateFile, targetFolder, sourceFile, deleteSourceText, ...
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

    // Geöffnete Datei = übergeordnete Notiz
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

    // Atomare Notizen erstellen; die geöffnete Notiz wird als "up" der obersten Ebene gesetzt.
    // "Übungsaufgaben", "Quellen" und "Unterthemen" sind keine Themen und werden nicht aufgeteilt.
    const stopHeadings = options.stopHeadings || ["Übungsaufgaben", "Quellen", "Referenz", "Unterthemen"];
    const result = await tp.user.createAtomicNotes(tp, {
        ...options,
        stopHeadings,
        sourceFile: openFile,
        existingTags: [openFile.basename],
        skipPrompt: true
    });

    // createAtomicNotes gibt bei Abbruch (z.B. keine Überschriften) undefined zurück
    if (result === undefined) return;

    const content = (await app.vault.read(openFile)).replace(/\r\n/g, "\n");
    const hasUnterthemen = /^#\s+Unterthemen\s*$/m.test(content);
    const block = buildUnterthemenBlock();
    const deleteSourceText = options.deleteSourceText !== false;

    let newContent;
    if (deleteSourceText) {
        // Verwendeten Text entfernen: von der ersten Überschrift bis zur ersten Stopp-Überschrift
        // (bzw. bis zum Dateiende). Text vor der ersten Überschrift und die Metadaten bleiben erhalten.
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
        // Einfügen vor "# Übungsaufgaben", sonst vor "# Quellen", sonst am Ende
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
