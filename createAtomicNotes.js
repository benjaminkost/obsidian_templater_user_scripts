/**
 * Templater User Script: createAtomicNotes
 * 
 * Konvertiert aus Python (create_notes_from_big_note).
 * Teilt ein langes Dokument anhand seiner Überschriften (#, ##, ###, ...) in atomare Notizen auf.
 * Baut dabei automatisch die Eltern-Kind-Hierarchie (Breadcrumbs) in die 'mytags'-Metadaten ein.
 * 
 * Verwendung:
 * 1) Interaktiv im Template:
 *    <%* await tp.user.createAtomicNotes(tp) -%>
 * 
 * 2) Mit Optionen aufrufen:
 *    <%* await tp.user.createAtomicNotes(tp, {
 *        sourceFile: "Pfad/zur/grossen_notiz.md",
 *        templateFile: "5 - Templates and Scripts/Template Notes/MeinTemplate.md",
 *        existingTags: ["202610091200 - Oberthema"],
 *        targetFolder: "" // Root des Vaults oder z.B. "1 - Rough Notes"
 *    }) -%>
 */

function deleteMetadataInString(fileStr) {
    if (!fileStr) return "";
    const normalized = fileStr.replace(/\r\n/g, "\n");
    // Entfernt Frontmatter am Anfang der Notiz (--- ... ---)
    return normalized.replace(/^---\n[\s\S]*?\n---\s*\n?/, "");
}

function checkIfStringContainsHeadlines(fileStr) {
    const headlineRegex = /^#+\s+/m;
    if (!headlineRegex.test(fileStr)) {
        throw new Error("There has to be headlines in the document to separate it in atomic notes!");
    }
}

function addAliasToListOfMytags(mytagsList) {
    const prefixRegex = /^(\d{12})( - | )(.+)$/;
    const newMytagsList = [];
    for (const mytag of (mytagsList || [])) {
        if (!mytag) continue;
        if (mytag.includes("|")) {
            newMytagsList.push(mytag);
            continue;
        }
        const match = mytag.match(prefixRegex);
        if (match) {
            const title = match[3];
            newMytagsList.push(`${mytag}|${title}`);
        } else {
            newMytagsList.push(mytag);
        }
    }
    return newMytagsList;
}

function createUpperPartOfTemplate(genericTemplateStart, mytagsList, aliases = null) {
    let finalTemplate = genericTemplateStart || "";
    const timestamp = window.moment ? window.moment().format("DD.MM.YYYY HH:mm") : new Date().toLocaleString("de-DE");

    // 1. Zeitstempel ("created date:" bzw. "created date:": ...)
    const createdDateRegex = /(\n["']?created date["']?:\s*).*(\n)/i;
    if (createdDateRegex.test(finalTemplate)) {
        finalTemplate = finalTemplate.replace(createdDateRegex, `$1${timestamp}$2`);
    }

    // Templater-Platzhalter für Datum ersetzen, falls vorhanden
    finalTemplate = finalTemplate.replaceAll('<% tp.date.now("DD.MM.YYYY HH:mm") %>', timestamp);
    finalTemplate = finalTemplate.replaceAll("<% tp.date.now('DD.MM.YYYY HH:mm') %>", timestamp);
    finalTemplate = finalTemplate.replaceAll('<%tp.date.now("DD.MM.YYYY HH:mm")%>', timestamp);
    finalTemplate = finalTemplate.replaceAll("<%tp.date.now('DD.MM.YYYY HH:mm')%>", timestamp);

    // 2. Mytags-Sektion
    const strOfMytags = (mytagsList || []).map(tag => `  - "[[${tag}]]"\n`).join("");
    const regexForMytagsSection = /mytags:\n([\s\S]*?)(?=^[a-zA-Z0-9_-]+:|^---|\Z)/m;
    const matchExistingMytags = finalTemplate.match(regexForMytagsSection);

    if (matchExistingMytags) {
        const existingTags = matchExistingMytags[1];
        finalTemplate = finalTemplate.replace(
            regexForMytagsSection,
            `mytags:\n${existingTags}${strOfMytags}`
        );
    } else if (/mytags:\s*\n?/i.test(finalTemplate)) {
        finalTemplate = finalTemplate.replace(/mytags:\s*\n?/i, `mytags:\n${strOfMytags}`);
    } else if (/^---\n[\s\S]*?\n---/m.test(finalTemplate)) {
        finalTemplate = finalTemplate.replace(/\n---/, `\nmytags:\n${strOfMytags}---`);
    }

    // 3. Aliases-Sektion
    if (aliases && aliases.length > 0) {
        const strOfAliases = aliases.map(alias => `  - ${alias}\n`).join("");
        const regexForAliasesSection = /(\naliases:\n)([\s\S]*?)(?=^[a-zA-Z0-9_-]+:|^---|\Z)/m;

        if (regexForAliasesSection.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(
                regexForAliasesSection,
                `$1$2${strOfAliases}`
            );
        } else if (/\naliases:\s*\n?/i.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(/\naliases:\s*\n?/i, `\naliases:\n${strOfAliases}`);
        } else if (/^---\n[\s\S]*?\n---/m.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(/\n---/, `\naliases:\n${strOfAliases}---`);
        }
    }

    return finalTemplate;
}

function cleanTitle(title) {
    if (!title) return "";
    // Entfernt fuehrende Nummerierungen wie "1. ", "1.1 ", "1.1.2 ", etc.
    const noStructureNumbers = title.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim();
    // Entfernt ungueltige Zeichen fuer Obsidian-Dateinamen: \ / : | # ^ [ ] * ? " < >
    const safeTitle = noStructureNumbers.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
    return safeTitle;
}

async function resolveTemplate(app, tp, options) {
    let templateStart = "";
    let templateEnd = "";

    // A) Explizit als Strings uebergeben
    if (typeof options.templateStart === "string") {
        templateStart = options.templateStart;
        templateEnd = typeof options.templateEnd === "string" ? options.templateEnd : "";
        return { templateStart, templateEnd };
    }

    // B) Explizite Dateipfade
    if (options.templateStartFile) {
        const file = app.vault.getAbstractFileByPath(options.templateStartFile);
        if (file) templateStart = await app.vault.read(file);
    }
    if (options.templateEndFile) {
        const file = app.vault.getAbstractFileByPath(options.templateEndFile);
        if (file) templateEnd = await app.vault.read(file);
    }
    if (templateStart) {
        return { templateStart, templateEnd };
    }

    // C) Einzelne Template-Datei (TFile oder Pfad)
    let templateFile = options.templateFile;
    if (typeof templateFile === "string") {
        templateFile = app.vault.getAbstractFileByPath(templateFile);
    }

    // D) Interaktive Auswahl per Suggester, falls nicht angegeben
    if (!templateFile && tp && tp.system) {
        const templateFolder = "5 - Templates and Scripts/Template Notes";
        let templateFiles = app.vault.getMarkdownFiles()
            .filter(f => f.path.startsWith(templateFolder + "/"));

        if (templateFiles.length === 0) {
            templateFiles = app.vault.getMarkdownFiles()
                .filter(f => f.path.startsWith("5 - Templates and Scripts/"));
        }

        if (templateFiles.length > 0) {
            const displayNames = templateFiles.map(f =>
                f.path.replace(/\.md$/, "").replace(/^5 - Templates and Scripts\/(Template Notes\/)?/, "")
            );
            templateFile = await tp.system.suggester(displayNames, templateFiles, false, "Welches Template möchtest du nutzen?");
        }
    }

    if (templateFile) {
        const content = await app.vault.read(templateFile);
        // Pruefen auf Cursor / Split-Marker
        const splitMarkerRegex = /<%[\s*_]*tp\.file\.cursor\([^)]*\)[\s*_]*%>|%%CONTENT%%|<!--\s*content\s*-->/i;
        const match = content.match(splitMarkerRegex);
        if (match) {
            templateStart = content.substring(0, match.index);
            templateEnd = content.substring(match.index + match[0].length);
        } else {
            templateStart = content;
            templateEnd = "";
        }
        return { templateStart, templateEnd };
    }

    // Fallback: Standard-Header
    templateStart = `---\n"created date:": \naliases:\nmytags:\n---\n`;
    templateEnd = "";
    return { templateStart, templateEnd };
}

async function createAtomicNotes(tp, options = {}) {
    const app = tp.app || window.app;

    // 1. Quelldatei bestimmen
    let sourceFile = null;
    if (options.sourceFile) {
        sourceFile = typeof options.sourceFile === "string"
            ? app.vault.getAbstractFileByPath(options.sourceFile)
            : options.sourceFile;
    } else if (tp.config && tp.config.target_file) {
        sourceFile = tp.config.target_file;
    } else {
        sourceFile = app.workspace.getActiveFile();
    }

    if (!sourceFile && tp.system) {
        const allMarkdownFiles = app.vault.getMarkdownFiles();
        const displayNames = allMarkdownFiles.map(f => f.basename);
        sourceFile = await tp.system.suggester(displayNames, allMarkdownFiles, false, "Welche Notiz soll aufgeteilt werden?");
    }

    if (!sourceFile) {
        new Notice("❌ Keine Quelldatei gefunden oder ausgewählt!");
        return;
    }

    // 2. Templates (Start und End) laden
    const { templateStart, templateEnd } = await resolveTemplate(app, tp, options);

    // 3. Oberthema / existingTags bestimmen
    let existingTags = options.existingTags || [];
    if (typeof existingTags === "string") {
        existingTags = [existingTags];
    }

    if ((!options.existingTags || options.existingTags.length === 0) && tp.system && !options.skipPrompt) {
        const allNotes = app.vault.getMarkdownFiles();
        const displayAllNotes = ["(Kein Oberthema)", ...allNotes.map(f => f.basename)];
        const values = [null, ...allNotes];

        const upTopic = await tp.system.suggester(displayAllNotes, values, false, "Welchem Oberthema sollen die erstellten Notes zugeordnet werden? (Optional)");
        if (upTopic) {
            existingTags = [upTopic.basename];
        }
    }

    // 4. Zielordner (Standard: Root des Vaults, wie im Python-Skript)
    const targetFolder = (options.targetFolder !== undefined) ? options.targetFolder.replace(/\/+$/, "") : "";

    // 5. Quelldatei auslesen und bereinigen
    let fileStr = (await app.vault.read(sourceFile)).replace(/\r\n/g, "\n");
    fileStr = deleteMetadataInString(fileStr);

    try {
        checkIfStringContainsHeadlines(fileStr);
    } catch (e) {
        new Notice(`❌ ${e.message}`);
        return;
    }

    // 6. Zeilen durchlaufen und Hierarchie aufbauen
    const lines = fileStr.split("\n");
    const regexForHeadlineTitle = /^(#+)\s+(.*)/;
    const currentPath = {};
    const notes = [];
    let currentNote = null;
    const usedFileNames = new Set();

    for (const line of lines) {
        const match = line.match(regexForHeadlineTitle);

        if (match) {
            const hashes = match[1];
            const title = match[2].trim();
            const currentLevel = hashes.length;

            // Abbruchbedingung bei "Referenz" (analog zu exit() im Python-Code)
            if (title === "Referenz") {
                break;
            }

            const timestamp = window.moment ? window.moment().format("YYYYMMDDHHmm") : tp.date.now("YYYYMMDDHHmm");
            const safeTitle = cleanTitle(title);

            let currentFileName = `${timestamp} - ${safeTitle}`;
            let counter = 1;
            while (
                usedFileNames.has(currentFileName) ||
                app.vault.getAbstractFileByPath(targetFolder ? `${targetFolder}/${currentFileName}.md` : `${currentFileName}.md`)
            ) {
                currentFileName = `${timestamp} - ${safeTitle} (${counter})`;
                counter++;
            }
            usedFileNames.add(currentFileName);

            currentPath[currentLevel] = currentFileName;

            // Alle Ebenen unterhalb der aktuellen Ebene entfernen
            for (const k of Object.keys(currentPath)) {
                if (Number(k) > currentLevel) {
                    delete currentPath[k];
                }
            }

            // Eltern-Titel ermitteln (alle Ebenen < currentLevel)
            const parentTitles = Object.keys(currentPath)
                .map(Number)
                .filter(k => k < currentLevel)
                .sort((a, b) => a - b)
                .map(k => currentPath[k]);

            const existingTagsWithAliases = addAliasToListOfMytags(existingTags || []);
            const parentTitlesWithAliases = addAliasToListOfMytags(parentTitles);
            const combinedMytagsList = [...existingTagsWithAliases, ...parentTitlesWithAliases];

            let noteStartText = createUpperPartOfTemplate(templateStart, combinedMytagsList, [safeTitle]);

            // Templater-Titel ersetzen
            noteStartText = noteStartText.replaceAll("<% tp.file.title %>", currentFileName);
            noteStartText = noteStartText.replaceAll("<%tp.file.title%>", currentFileName);

            const filePath = targetFolder ? `${targetFolder}/${currentFileName}.md` : `${currentFileName}.md`;

            currentNote = {
                fileName: currentFileName,
                path: filePath,
                startText: noteStartText,
                bodyLines: []
            };
            notes.push(currentNote);

        } else if (currentNote) {
            currentNote.bodyLines.push(line);
        }
    }

    if (notes.length === 0) {
        new Notice("⚠️ Keine atomaren Notizen zum Erstellen gefunden.");
        return;
    }

    // 7. Notizen im Vault erstellen
    let createdCount = 0;
    for (const note of notes) {
        let body = note.bodyLines.join("\n");
        if (body.length > 0 && !body.startsWith("\n")) {
            body = "\n" + body;
        }

        let fullText = note.startText;
        if (body.trim().length > 0) {
            fullText += body;
        }
        if (templateEnd && templateEnd.trim().length > 0) {
            fullText += (fullText.endsWith("\n") ? "" : "\n") + templateEnd;
        }

        try {
            const existingFile = app.vault.getAbstractFileByPath(note.path);
            if (existingFile) {
                await app.vault.modify(existingFile, fullText);
            } else {
                await app.vault.create(note.path, fullText);
            }
            createdCount++;
        } catch (err) {
            console.error(`Fehler beim Erstellen der Notiz '${note.path}':`, err);
        }
    }

    new Notice(`✅ ${createdCount} atomare Notizen erfolgreich erstellt!`);
    return "";
}

// Export der Hauptfunktion und Einzelfunktionen fuer maximale Flexibilitaet
createAtomicNotes.deleteMetadataInString = deleteMetadataInString;
createAtomicNotes.checkIfStringContainsHeadlines = checkIfStringContainsHeadlines;
createAtomicNotes.addAliasToListOfMytags = addAliasToListOfMytags;
createAtomicNotes.createUpperPartOfTemplate = createUpperPartOfTemplate;
createAtomicNotes.cleanTitle = cleanTitle;
createAtomicNotes.createNotesFromBigNote = createAtomicNotes;

module.exports = { createAtomicNotes };
