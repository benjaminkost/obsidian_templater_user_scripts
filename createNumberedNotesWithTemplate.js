/**
 * Templater User Script: createNumberedNotesWithTemplate
 *
 * Creates multiple notes based on a user-selected template, where the note title
 * is enumerated by incrementing the number at the end of the title.
 *
 * Examples:
 *   - "Übungsblatt 1" with count 3 -> "Übungsblatt 1", "Übungsblatt 2", "Übungsblatt 3"
 *   - "Übungsblatt 01" with count 3 -> "Übungsblatt 01", "Übungsblatt 02", "Übungsblatt 03"
 *   - "Aufgabe" with count 3 -> "Aufgabe 1", "Aufgabe 2", "Aufgabe 3"
 *
 * Each created note:
 *   - Receives the 12-digit Zettelkasten timestamp prefix: "YYYYMMDDHHmm - Title"
 *   - Replaces Templater title and date placeholders
 *   - Links to the chosen parent topic (up:)
 *   - Automatically includes the #addedByCode tag in the frontmatter
 *
 * Usage in a template:
 *   <%* await tp.user.createNumberedNotesWithTemplate(tp) -%>
 */

function generateNumberedTitles(baseInput, countStr) {
    const count = parseInt(countStr, 10);
    if (isNaN(count) || count <= 0) return [];

    const trimmed = (baseInput || "").trim();
    if (!trimmed) return [];

    let prefix = trimmed;
    let startNum = 1;
    let padLength = 0;

    // Check if the title already ends with a number (e.g. "Aufgabe 1" or "Blatt 05")
    const match = trimmed.match(/^(.*?)(\d+)$/);
    if (match) {
        prefix = match[1];
        startNum = parseInt(match[2], 10);
        padLength = match[2].length > 1 && match[2].startsWith("0") ? match[2].length : 0;
    } else {
        // If not ending with a separator or space, add a space before the number
        if (!/[\s_]$/.test(prefix)) {
            prefix += " ";
        }
    }

    const titles = [];
    for (let i = 0; i < count; i++) {
        const num = startNum + i;
        const numStr = padLength > 0 ? String(num).padStart(padLength, "0") : String(num);
        titles.push(`${prefix}${numStr}`);
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

module.exports = async function (tp, options = {}) {
    const app = tp.app || window.app;

    // 1. Template selection
    const templateFolder = options.templateFolder || "5 - Templates and Scripts/Template Notes";
    let templateFiles = app.vault.getMarkdownFiles()
        .filter(f => f.path.startsWith(templateFolder + "/"));

    if (templateFiles.length === 0) {
        templateFiles = app.vault.getMarkdownFiles()
            .filter(f => f.path.startsWith("5 - Templates and Scripts/"));
    }

    if (templateFiles.length === 0) {
        new Notice(`❌ Keine Templates in '${templateFolder}' gefunden!`);
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
        new Notice("Abgebrochen: Kein Template ausgewählt.");
        return;
    }

    const templateName = templateFile.basename;
    const templateContent = await app.vault.read(templateFile);

    // 2. Parent topic prompt (up:)
    let upTopic = options.upTopic;
    if (upTopic === undefined && tp.system) {
        const allNotes = app.vault.getMarkdownFiles();
        const displayAllNotes = ["(Kein Oberthema)", ...allNotes.map(f => f.basename)];
        const values = [null, ...allNotes];
        upTopic = await tp.system.suggester(displayAllNotes, values, false, "Welchem Oberthema sollen die erstellten Notes zugeordnet werden? (Optional)");
    }

    // 3. Base title prompt
    let titleInput = options.baseTitle;
    if (!titleInput && tp.system) {
        titleInput = await tp.system.prompt(`Template '${templateName}' geladen. Gib den Titel ein (z. B. 'Übungsblatt 1' oder 'Aufgabe'):`);
    }

    if (!titleInput) {
        new Notice("Abgebrochen: Kein Titel eingegeben.");
        return;
    }

    // 4. Count prompt
    let countInput = options.count;
    if (!countInput && tp.system) {
        countInput = await tp.system.prompt("Wie viele Notizen sollen erstellt werden (Anzahl)?", "5");
    }

    const titles = generateNumberedTitles(titleInput, countInput);
    if (titles.length === 0) {
        new Notice("Abgebrochen: Ungültige Anzahl oder ungültiger Titel.");
        return;
    }

    // 5. Note creation loop
    const timestamp = tp.date ? tp.date.now("YYYYMMDDHHmm") : (window.moment ? window.moment().format("YYYYMMDDHHmm") : "");
    const currentDate = tp.date ? tp.date.now("DD.MM.YYYY HH:mm") : (window.moment ? window.moment().format("DD.MM.YYYY HH:mm") : "");
    const targetFolder = (options.targetFolder !== undefined) ? options.targetFolder.replace(/\/+$/, "") : "";

    let createdCount = 0;
    for (const title of titles) {
        const cleanTitle = title.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
        const fileName = timestamp ? `${timestamp} - ${cleanTitle}` : cleanTitle;
        const filePath = targetFolder ? `${targetFolder}/${fileName}.md` : `${fileName}.md`;

        let finalContent = templateContent;

        // Replace Templater placeholders
        finalContent = finalContent.replace(/<%\s*tp\.file\.title\.split\(["']\s*-\s*["']\)\[1\]\s*%>/gi, cleanTitle);
        finalContent = finalContent.replace(/<%\s*tp\.file\.title\s*%>/gi, fileName);
        finalContent = finalContent.replace(/<%\s*tp\.date\.now\(\s*["']DD\.MM\.YYYY HH:mm["']\s*\)\s*%>/gi, currentDate);

        // Replace created date in frontmatter
        const createdDateRegex = /\n["']?created date:?["']?:?\s*.*(\n|$)/i;
        if (createdDateRegex.test(finalContent)) {
            finalContent = finalContent.replace(createdDateRegex, `\n"created date": ${currentDate}$1`);
        }

        // Link parent topic in up:
        if (upTopic) {
            const aliasOfNote = upTopic.basename.split(" - ").at(-1) ? "|" + upTopic.basename.split(" - ").at(-1) : "";
            const noteNameWithAlias = upTopic.basename + aliasOfNote;
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

        // Add #addedByCode tag to frontmatter
        finalContent = addTagToFrontmatter(finalContent, "addedByCode");

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

    new Notice(`✅ ${createdCount} Notizen ('${titles[0]}' bis '${titles[titles.length - 1]}') basierend auf '${templateName}' erstellt!`);
    return "";
};
