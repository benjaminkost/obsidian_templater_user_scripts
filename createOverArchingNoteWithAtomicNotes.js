/**
 * Templater User Script: createOverArchingNoteWithAtomicNotes
 *
 * Works like createAtomicNotes.js (splits the open note into atomic notes based on its headings),
 * with these differences:
 *  - The open note is the overarching note: atomic notes without a parent of their own
 *    (top heading level) get it as "up".
 *  - Lets the user define up to which heading level (e.g. H1, H2, H3, ...) new notes should be created.
 *    Sub-headings deeper than the chosen level remain inside their parent note's body (starting at #).
 *  - Lets the user choose how contents in the overarching note should be handled:
 *    1) Default: Delete transferred text and insert the "# Unterthemen" Dataview block.
 *    2) Optional: Keep the heading hierarchy and link paragraphs via block references (![[Note#^id]]).
 *
 * Usage:
 *   <%* await tp.user.createOverArchingNoteWithAtomicNotes(tp) -%>
 *
 * Options (passed on to createAtomicNotes):
 *   maxLevel (1-6)            - Maximum heading level to turn into atomic notes
 *   useBlockReferences (bool) - Keep content as paragraph references (![[...#^id]]) vs. delete and insert # Unterthemen
 *   templateFile              - Path or TFile of the template to use (skips template prompt)
 *   templateFolder            - Path to folder containing templates (default: "5 - Templates and Scripts/Template Notes")
 *   skipPrompt (bool)         - If true, skips interactive prompts (e.g. template selection)
 *   skipTemplatePrompt (bool) - If true, skips interactive template selection
 *   targetFolder              - Target folder for created notes (default: vault root)
 *   sourceFile                - Source note (default: active file)
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

function isInsideInlineCode(line, offset) {
    const before = line.slice(0, offset);
    const count = (before.match(/`/g) || []).length;
    return count % 2 === 1;
}

function isNonNoteHeading(title, stopHeadings = []) {
    if (!title) return false;
    const clean = title.replace(/^\s*#+\s*/, "").replace(/\[\^[^\]]+\]/g, "").trim().toLowerCase();
    const noNum = clean.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim().toLowerCase();

    const builtInNonNotes = ["quellen", "übungsaufgaben", "uebungsaufgaben", "referenz", "unterthemen"];
    if (builtInNonNotes.includes(clean) || builtInNonNotes.includes(noNum)) {
        return true;
    }

    for (const sh of stopHeadings) {
        if (!sh) continue;
        const shClean = sh.replace(/^\s*#+\s*/, "").replace(/\[\^[^\]]+\]/g, "").trim().toLowerCase();
        const shNoNum = shClean.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim().toLowerCase();
        if (clean === shClean || noNum === shNoNum || title.trim().toLowerCase() === sh.trim().toLowerCase()) {
            return true;
        }
    }

    return false;
}

function replaceHeadingReferencesInText(text, headingMap) {
    if (!text || !headingMap || headingMap.size === 0) return text;

    let inFence = false;
    const lines = text.split(/\r?\n/).map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        return line.replace(/(?<!\!)\[\[([^\]\r\n]+)\]\]/g, (match, inner, offset) => {
            if (isInsideInlineCode(line, offset)) {
                return match;
            }

            const pipeIdx = inner.indexOf("|");
            const linkTarget = pipeIdx !== -1 ? inner.slice(0, pipeIdx).trim() : inner.trim();
            const existingAlias = pipeIdx !== -1 ? inner.slice(pipeIdx + 1).trim() : null;

            let headingKey = linkTarget;
            let isInternalAnchor = false;
            if (headingKey.startsWith("#")) {
                headingKey = headingKey.slice(1).trim();
                isInternalAnchor = true;
            }

            let sectionAnchor = "";
            if (!isInternalAnchor && headingKey.includes("#")) {
                const parts = headingKey.split("#");
                headingKey = parts[0].trim();
                sectionAnchor = "#" + parts.slice(1).join("#").trim();
            }

            const rep = headingMap.get(headingKey);
            if (rep) {
                const targetAnchor = rep.sectionAnchor || sectionAnchor;
                if (linkTarget === rep.fileName || linkTarget === `${rep.fileName}${targetAnchor}`) {
                    return match;
                }
                const alias = existingAlias || rep.alias;
                return `[[${rep.fileName}${targetAnchor}|${alias}]]`;
            }

            return match;
        });
    });

    return lines.join("\n");
}

/**
 * Renumbers footnotes in a text sequentially starting at 1.
 * Supports references ([^id]) and definitions ([^id]:).
 * Protects code blocks (``` / ~~~), inline code (`...`), and math blocks ($$).
 *
 * @param {string} text - The markdown content to renumber.
 * @param {string} [headerText=""] - Optional extra text to scan for references first.
 * @returns {string} Text with footnotes renumbered from 1.
 */
function renumberFootnotesInText(text, headerText = "") {
    if (!text) return text;

    const ids = [];
    const seen = new Set();

    function scan(str) {
        if (!str) return;
        let inFence = false;
        let inMath = false;
        const lines = str.split(/\r?\n/);
        for (const line of lines) {
            if (/^\s*(```|~~~)/.test(line)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;
            if (/^\s*\$\$/.test(line)) {
                inMath = !inMath;
                continue;
            }
            if (inMath) continue;

            for (const match of line.matchAll(/\[\^([a-zA-Z0-9_-]+)\](?!\s*:)/g)) {
                const offset = match.index;
                if (!isInsideInlineCode(line, offset)) {
                    const id = match[1];
                    if (!seen.has(id)) {
                        seen.add(id);
                        ids.push(id);
                    }
                }
            }
        }
    }

    scan(headerText);
    scan(text);

    if (ids.length === 0) return text;

    const idMap = new Map();
    let counter = 1;
    for (const id of ids) {
        idMap.set(id, String(counter++));
    }

    let inFence = false;
    let inMath = false;
    const lines = text.split(/\r?\n/).map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;
        if (/^\s*\$\$/.test(line)) {
            inMath = !inMath;
            return line;
        }
        if (inMath) return line;

        return line.replace(/\[\^([a-zA-Z0-9_-]+)\]/g, (match, id, offset) => {
            if (isInsideInlineCode(line, offset)) {
                return match;
            }
            if (idMap.has(id)) {
                return `[^${idMap.get(id)}]`;
            }
            return match;
        });
    });

    return lines.join("\n");
}

function createOverArchingNoteWithAtomicNotes(tp, options = {}) {
    const promise = (async () => {
        const app = tp.app || window.app;

        if (typeof tp.user?.createAtomicNotes !== "function") {
            new Notice("❌ tp.user.createAtomicNotes wurde nicht gefunden (createAtomicNotes.js im User-Scripts-Ordner?).");
            return "";
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
            return "";
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
                "Ebene 5 (#####) - Bis H5",
                "❌ Vorgang abbrechen"
            ];
            const levelValues = [6, 1, 2, 3, 4, 5, "CANCEL"];

            const chosen = await tp.system.suggester(
                levelChoices,
                levelValues,
                false,
                "Bis zu welchem Überschriften-Niveau sollen neue Notizen erstellt werden?"
            );

            if (chosen === "CANCEL" || chosen === undefined || chosen === null) {
                new Notice("Abgebrochen: Vorgang abgebrochen.");
                return "";
            }
            maxLevel = chosen;
        }

        // Ask user whether to delete transferred content (default) or keep block references
        let useBlockReferences = options.useBlockReferences;
        if (useBlockReferences === undefined && tp.system) {
            const modeChoices = [
                "Inhalte löschen & '# Unterthemen' (Dataview) einfügen [Standard]",
                "Inhalte als Paragraphen-Referenzen (![[Notiz#^id]]) beibehalten",
                "❌ Vorgang abbrechen"
            ];
            const modeValues = [false, true, "CANCEL"];

            const chosenMode = await tp.system.suggester(
                modeChoices,
                modeValues,
                false,
                "Wie sollen die Inhalte in der ursprünglichen Notiz behandelt werden?"
            );

            if (chosenMode === "CANCEL" || chosenMode === undefined || chosenMode === null) {
                new Notice("Abgebrochen: Vorgang abgebrochen.");
                return "";
            }
            useBlockReferences = chosenMode;
        } else if (useBlockReferences === undefined) {
            useBlockReferences = false; // Default: false
        }

        // Create atomic notes
        // The open note is set as "up" for top-level notes.
        // "Übungsaufgaben", "Quellen" and "Unterthemen" are not topics and are not split.
        const stopHeadings = options.stopHeadings || ["Übungsaufgaben", "Quellen", "Referenz", "Unterthemen"];

        const result = await tp.user.createAtomicNotes(tp, {
            ...options,
            useBlockReferences,
            maxLevel,
            stopHeadings,
            sourceFile: openFile,
            existingTags: [openFile.basename],
            skipPrompt: options.skipPrompt ?? options.skipTemplatePrompt ?? false,
            silent: true,
            addCodeTag: options.addCodeTag ?? options.addAddedByCode ?? false
        });

        // createAtomicNotes returns "" or empty object on abort (e.g. no headings or cancelled)
        if (!result || !result.createdCount) return "";

        if (useBlockReferences && result.overarchingContent) {
            let finalContent = result.overarchingContent;
            const hasUnterthemen = /^\s*#\s+Unterthemen\s*$/m.test(finalContent);
            if (!hasUnterthemen) {
                const block = buildUnterthemenBlock();
                const anchor = finalContent.match(/^\s*#+\s+(\d+[\.\-_)]?\s*)?Übungsaufgaben\s*$/m) ||
                               finalContent.match(/^\s*#+\s+(\d+[\.\-_)]?\s*)?Quellen\s*$/m);
                if (anchor) {
                    finalContent = finalContent.slice(0, anchor.index) + block + "\n" + finalContent.slice(anchor.index);
                } else {
                    const separator = finalContent.endsWith("\n") ? "\n" : "\n\n";
                    finalContent = finalContent + separator + block;
                }
            }

            if (result.headingMap && result.headingMap.size > 0) {
                finalContent = replaceHeadingReferencesInText(finalContent, result.headingMap);
            }

            finalContent = renumberFootnotesInText(finalContent);

            await app.vault.modify(openFile, finalContent);
            new Notice(`✅ ${result.createdCount} atomare Notizen erstellt und Inhalte als Paragraphen-Referenzen verlinkt!`);
            return "";
        }

        // Fallback if useBlockReferences: false (Default mode: delete transferred content & insert Dataview)
        const content = (await app.vault.read(openFile)).replace(/\r\n?/g, "\n");
        const hasUnterthemen = /^\s*#\s+Unterthemen\s*$/m.test(content);
        const block = buildUnterthemenBlock();
        const deleteSourceText = options.deleteSourceText !== false;

        let newContent;
        if (deleteSourceText) {
            // Remove the used text: from the first heading to the first stop heading
            // (or to the end of the file). Text before the first heading and the metadata are kept.
            const fm = content.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
            const bodyStart = fm ? fm[0].length : 0;
            const body = content.slice(bodyStart);

            let minHeadingLevel = 6;
            let testM;
            const testRegex = /^\s*(#+)\s+(.*)$/gm;
            while ((testM = testRegex.exec(body)) !== null) {
                minHeadingLevel = Math.min(minHeadingLevel, testM[1].length);
            }

            let firstIdx = -1;
            let stopIdx = -1;
            const headingRegex = /^\s*(#+)\s+(.*)$/gm;
            let m;
            while ((m = headingRegex.exec(body)) !== null) {
                if (firstIdx === -1) firstIdx = m.index;
                const level = m[1].length;
                const headingTitle = m[2].trim();
                const cleanHeading = headingTitle.replace(/^(\d+[\.\-_)]?)+\s*/, "").replace(/\[\^[^\]]+\]/g, "").trim();
                const isStop = stopHeadings.includes(headingTitle) ||
                               stopHeadings.includes(cleanHeading) ||
                               isNonNoteHeading(headingTitle, stopHeadings);
                if (level <= minHeadingLevel && isStop) {
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
            const anchor = content.match(/^\s*#+\s+(\d+[\.\-_)]?\s*)?Übungsaufgaben\s*$/m) ||
                           content.match(/^\s*#+\s+(\d+[\.\-_)]?\s*)?Quellen\s*$/m);
            if (anchor) {
                newContent = content.slice(0, anchor.index) + block + "\n" + content.slice(anchor.index);
            } else {
                const separator = content.length === 0 ? "" : (content.endsWith("\n") ? "\n" : "\n\n");
                newContent = content + separator + block;
            }
        }

        if (result.headingMap && result.headingMap.size > 0) {
            newContent = replaceHeadingReferencesInText(newContent, result.headingMap);
        }

        newContent = renumberFootnotesInText(newContent);

        await app.vault.modify(openFile, newContent);
        new Notice(deleteSourceText
            ? `✅ Text in ${result.createdCount} atomare Notizen überführt und aus der Datei entfernt.`
            : "✅ Abschnitt '# Unterthemen' hinzugefügt.");
        return "";
    })();

    promise.toString = () => "";
    promise.valueOf = () => "";
    if (typeof Symbol !== "undefined" && Symbol.toPrimitive) {
        promise[Symbol.toPrimitive] = () => "";
    }

    return promise;
}

module.exports = createOverArchingNoteWithAtomicNotes;
module.exports.buildUnterthemenBlock = buildUnterthemenBlock;
module.exports.replaceHeadingReferencesInText = replaceHeadingReferencesInText;
module.exports.renumberFootnotesInText = renumberFootnotesInText;
module.exports.isNonNoteHeading = isNonNoteHeading;
