/**
 * Templater User Script: createNumberedNotesWithTemplate
 *
 * Creates multiple notes based on a user-selected template, where the note title
 * is enumerated using a pattern such as "Name {fortlaufende Nummer}" and a start/end number.
 *
 * Examples:
 *   - Pattern "Aufgabe {fortlaufende Nummer}", Start 1, End 5 -> "Aufgabe 1", "Aufgabe 2", ...
 *   - Pattern "Übungsblatt {n}", Start "01", End "03" -> "Übungsblatt 01", "Übungsblatt 02", "Übungsblatt 03"
 *   - Pattern "Kapitel {0n}", Start 1, End 3 -> "Kapitel 01", "Kapitel 02", "Kapitel 03"
 *   - Pattern "Übungsblatt 01", Start 1, End 3 -> "Übungsblatt 01", "Übungsblatt 02", "Übungsblatt 03"
 *   - Pattern "Aufgabe", Start 1, End 3 -> "Aufgabe 1", "Aufgabe 2", "Aufgabe 3"
 *
 * Features:
 *   - Generates notes with exact name "Name {fortlaufende Nummer}" (timestamp prefix optional, default: false)
 *   - Resolves Templater title and date placeholders
 *   - Optionally links to a chosen parent topic (up:)
 *   - Optional addedByCode tag (default: false)
 *   - Cancellable at every step without side-effects
 *
 * Usage in a template:
 *   <%* await tp.user.createNumberedNotesWithTemplate(tp) -%>
 */

function generateNumberedTitles(patternInput, startInput, endInput, countInput) {
    const pattern = (patternInput || "").trim();
    if (!pattern) return [];

    // Placeholder regex: {fortlaufende Nummer}, {n}, {nr}, {nummer}, {0n}, {00n}, {n:2}, case-insensitive
    const placeholderRegex = /\{(fortlaufende\s*nummer|nummer|nr|0*n(?::\d+)?)\}/i;
    const hasPlaceholder = placeholderRegex.test(pattern);

    let detectedPadLength = 0;
    let defaultStart = 1;

    if (hasPlaceholder) {
        const phMatch = pattern.match(placeholderRegex);
        const phContent = phMatch[1].toLowerCase();
        if (phContent.includes(":")) {
            const parts = phContent.split(":");
            detectedPadLength = parseInt(parts[1], 10) || 0;
        } else if (/^0+n$/.test(phContent)) {
            detectedPadLength = phContent.length; // e.g. "0n" -> 2, "00n" -> 3
        }
    } else {
        // Check if trailing number in pattern, e.g. "Übungsblatt 01"
        const trailingMatch = pattern.match(/^(.*?)(\d+)$/);
        if (trailingMatch) {
            defaultStart = parseInt(trailingMatch[2], 10);
            if (trailingMatch[2].startsWith("0") && trailingMatch[2].length > 1) {
                detectedPadLength = trailingMatch[2].length;
            }
        }
    }

    // Determine start number and input padding
    const startStr = (startInput !== undefined && startInput !== null && String(startInput).trim() !== "")
        ? String(startInput).trim()
        : String(defaultStart);

    let startNum = parseInt(startStr, 10);
    if (isNaN(startNum)) startNum = 1;

    // If startStr has leading zero(s), preserve length as padding
    if (startStr.length > 1 && startStr.startsWith("0") && !detectedPadLength) {
        detectedPadLength = startStr.length;
    }

    // Determine end number
    let endNum;
    if (endInput !== undefined && endInput !== null && String(endInput).trim() !== "") {
        const endStr = String(endInput).trim();
        endNum = parseInt(endStr, 10);
        if (endStr.length > 1 && endStr.startsWith("0") && !detectedPadLength) {
            detectedPadLength = endStr.length;
        }
    } else if (countInput !== undefined && countInput !== null && String(countInput).trim() !== "") {
        const count = parseInt(String(countInput).trim(), 10);
        if (!isNaN(count) && count > 0) {
            endNum = startNum + count - 1;
        }
    }

    if (isNaN(endNum)) {
        endNum = startNum + 4;
    }

    if (endNum < startNum) {
        const temp = startNum;
        startNum = endNum;
        endNum = temp;
    }

    const titles = [];
    for (let num = startNum; num <= endNum; num++) {
        const numStr = detectedPadLength > 0 ? String(num).padStart(detectedPadLength, "0") : String(num);
        let title;
        if (hasPlaceholder) {
            title = pattern.replace(placeholderRegex, numStr);
        } else {
            const trailingMatch = pattern.match(/^(.*?)(\d+)$/);
            if (trailingMatch) {
                title = `${trailingMatch[1]}${numStr}`;
            } else {
                const sep = /[\s_]$/.test(pattern) ? "" : " ";
                title = `${pattern}${sep}${numStr}`;
            }
        }
        titles.push(title);
    }

    return titles;
}

function addTagToFrontmatter(content, tag = "addedByCode") {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
        return `---\ntags:\n  - ${tag}\n---\n${content}`;
    }

    const frontmatter = fmMatch[1];
    const tagPattern = new RegExp(`(^|[\\s,\\["'])${tag}(["'\\]\\s]|$)`, "i");
    if (tagPattern.test(frontmatter)) {
        return content;
    }

    // Inline list: tags: [a, b]
    const inlineListRegex = /^tags:[ \t]*\[(.*?)\][ \t]*$/m;
    if (inlineListRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(inlineListRegex, (match, inner) => {
            const trimmed = inner.trim();
            return trimmed.length > 0 ? `tags: [${trimmed}, ${tag}]` : `tags: [${tag}]`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // Multiline list: tags:\n  - ...
    const tagsListRegex = /^tags:[ \t]*\r?\n((?:[ \t]+-.*(?:\r?\n|$))+)/m;
    if (tagsListRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(tagsListRegex, (match, existing) => {
            const existingLines = existing
                .split(/\r?\n/)
                .filter(line => line.trim().length > 0 && !line.includes("<%"))
                .map(line => line + "\n")
                .join("");
            return `tags:\n${existingLines}  - ${tag}\n`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // Empty tags key: tags: on its own line
    const emptyTagsRegex = /^tags:[ \t]*$/m;
    if (emptyTagsRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(emptyTagsRegex, `tags:\n  - ${tag}`);
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // Single value: tags: someTag
    const singleTagRegex = /^tags:[ \t]+([^\r\n\[]+)$/m;
    if (singleTagRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(singleTagRegex, (match, val) => {
            return `tags:\n  - ${val.trim()}\n  - ${tag}`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // Default: insert before closing ---
    return content.replace(/\r?\n---/, `\ntags:\n  - ${tag}\n---`);
}

async function createNumberedNotesWithTemplate(tp, options = {}) {
    const app = tp.app || (typeof window !== "undefined" ? window.app : undefined);
    if (!app) {
        console.error("Obsidian app instance not found.");
        return;
    }

    // 1. Template selection
    const templateFolder = options.templateFolder || "5 - Templates and Scripts/Template Notes";
    let templateFiles = app.vault.getMarkdownFiles()
        .filter(f => f.path.startsWith(templateFolder + "/"));

    if (templateFiles.length === 0) {
        templateFiles = app.vault.getMarkdownFiles()
            .filter(f => f.path.startsWith("5 - Templates and Scripts/"));
    }

    if (templateFiles.length === 0) {
        if (typeof Notice !== "undefined") new Notice(`❌ Keine Templates in '${templateFolder}' gefunden!`);
        return;
    }

    let templateFile = options.templateFile;
    if (typeof templateFile === "string") {
        templateFile = app.vault.getAbstractFileByPath(templateFile);
    }

    if (!templateFile && tp.system) {
        const displayNames = templateFiles.map(f =>
            f.path.replace(/\.md$/, "").replace(/^5 - Templates and Scripts\/(Template Notes\/)?/, "")
        );
        templateFile = await tp.system.suggester(displayNames, templateFiles, false, "Welches Template möchtest du nutzen?");
    }

    if (!templateFile) {
        if (typeof Notice !== "undefined") new Notice("Abgebrochen: Kein Template ausgewählt.");
        return;
    }

    const templateName = templateFile.basename;
    const templateContent = await app.vault.read(templateFile);

    // 2. Name pattern prompt (e.g. "Aufgabe {fortlaufende Nummer}" or "Übungsblatt {n}")
    let patternInput = options.pattern || options.baseTitle;
    if (!patternInput && tp.system) {
        patternInput = await tp.system.prompt(
            `Template '${templateName}' geladen. Gib das Namensmuster ein (z. B. 'Name {fortlaufende Nummer}' oder 'Aufgabe {n}'):`,
            "Name {fortlaufende Nummer}"
        );
    }

    if (!patternInput || !patternInput.trim()) {
        if (typeof Notice !== "undefined") new Notice("Abgebrochen: Kein Name eingegeben.");
        return;
    }

    // 3. Start number prompt
    let startInput = options.startNum;
    if (startInput === undefined && tp.system) {
        startInput = await tp.system.prompt("Startnummer:", "1");
    }

    if (startInput === null || startInput === undefined || String(startInput).trim() === "") {
        if (typeof Notice !== "undefined") new Notice("Abgebrochen: Keine Startnummer eingegeben.");
        return;
    }

    // 4. End number prompt
    let endInput = options.endNum;
    if (endInput === undefined && options.count === undefined && tp.system) {
        const defaultEnd = String(parseInt(startInput, 10) + 4 || 5);
        endInput = await tp.system.prompt("Endnummer:", defaultEnd);
    }

    if (endInput === null && options.count === undefined) {
        if (typeof Notice !== "undefined") new Notice("Abgebrochen: Keine Endnummer eingegeben.");
        return;
    }

    const titles = generateNumberedTitles(patternInput, startInput, endInput, options.count);
    if (titles.length === 0) {
        if (typeof Notice !== "undefined") new Notice("Abgebrochen: Ungültiger Bereich oder ungültiger Name.");
        return;
    }

    // 5. Parent topic prompt (up:) - optional
    let upTopic = options.upTopic;
    if (upTopic === undefined && tp.system) {
        const allNotes = app.vault.getMarkdownFiles();
        const displayAllNotes = ["(Kein Oberthema)", ...allNotes.map(f => f.basename)];
        const values = [null, ...allNotes];
        upTopic = await tp.system.suggester(displayAllNotes, values, false, "Welchem Oberthema sollen die erstellten Notes zugeordnet werden? (Optional)");
    }

    // 6. Config options
    const useTimestamp = options.useTimestamp === true; // Default false: notes are named exactly "Name {fortlaufende Nummer}"
    const addTag = options.addTag === true;             // Default false: addedByCode is optional and disabled by default

    // 7. Note creation loop
    const timestamp = tp.date ? tp.date.now("YYYYMMDDHHmm") : (typeof moment !== "undefined" ? moment().format("YYYYMMDDHHmm") : "");
    const currentDate = tp.date ? tp.date.now("DD.MM.YYYY HH:mm") : (typeof moment !== "undefined" ? moment().format("DD.MM.YYYY HH:mm") : "");
    const targetFolder = (options.targetFolder !== undefined) ? options.targetFolder.replace(/\/+$/, "") : "";

    let createdCount = 0;
    for (const title of titles) {
        const cleanTitle = title.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
        const fileName = (useTimestamp && timestamp) ? `${timestamp} - ${cleanTitle}` : cleanTitle;
        const filePath = targetFolder ? `${targetFolder}/${fileName}.md` : `${fileName}.md`;

        let finalContent = templateContent;

        // Replace Templater placeholders
        const titleWithoutPrefix = fileName.includes(" - ") ? fileName.split(" - ").slice(1).join(" - ") : cleanTitle;
        finalContent = finalContent.replace(/<%\s*tp\.file\.title\.split\(["']\s*-\s*["']\)\[1\]\s*%>/gi, titleWithoutPrefix);
        finalContent = finalContent.replace(/<%\s*tp\.file\.title\s*%>/gi, fileName);
        if (currentDate) {
            finalContent = finalContent.replace(/<%\s*tp\.date\.now\(\s*["']DD\.MM\.YYYY HH:mm["']\s*\)\s*%>/gi, currentDate);
        }

        // Replace created date in frontmatter
        if (currentDate) {
            const createdDateRegex = /\n["']?created date:?["']?:?\s*.*(\n|$)/i;
            if (createdDateRegex.test(finalContent)) {
                finalContent = finalContent.replace(createdDateRegex, `\n"created date": ${currentDate}$1`);
            }
        }

        // Link parent topic in up:
        if (upTopic) {
            const upBasename = upTopic.basename || upTopic.name || String(upTopic);
            const aliasOfNote = upBasename.split(" - ").at(-1) ? "|" + upBasename.split(" - ").at(-1) : "";
            const noteNameWithAlias = upBasename + aliasOfNote;
            const upLine = `  - "[[${noteNameWithAlias}]]"`;

            const regexForUpSection = /^up:[ \t]*(?:\r?\n((?:[ \t]+-.*(?:\r?\n|$))*))?/m;
            if (regexForUpSection.test(finalContent)) {
                finalContent = finalContent.replace(regexForUpSection, (match, existing) => {
                    const existingLines = (existing || "")
                        .split(/\r?\n/)
                        .filter(line => line.trim().length > 0 && !line.includes("<%"))
                        .map(line => line + "\n")
                        .join("");
                    return `up:\n${existingLines}${upLine}\n`;
                });
            } else if (/^---\r?\n[\s\S]*?\r?\n---/.test(finalContent)) {
                finalContent = finalContent.replace(/\r?\n---/, `\nup:\n${upLine}\n---`);
            }
        }

        // Optional addedByCode tag in frontmatter
        if (addTag) {
            finalContent = addTagToFrontmatter(finalContent, "addedByCode");
        }

        try {
            const existingFile = app.vault.getAbstractFileByPath(filePath);
            if (existingFile) {
                await app.vault.modify(existingFile, finalContent);
            } else {
                await app.vault.create(filePath, finalContent);
            }
            createdCount++;
        } catch (error) {
            console.error(`Fehler beim Erstellen von ${fileName}:`, error);
        }
    }

    if (typeof Notice !== "undefined") {
        new Notice(`✅ ${createdCount} Notizen ('${titles[0]}' bis '${titles[titles.length - 1]}') basierend auf '${templateName}' erstellt!`);
    }
    return "";
}

createNumberedNotesWithTemplate.generateNumberedTitles = generateNumberedTitles;
createNumberedNotesWithTemplate.addTagToFrontmatter = addTagToFrontmatter;

module.exports = createNumberedNotesWithTemplate;
