/**
 * Templater User Script: createAtomicNotes
 * 
 * Converted from Python (create_notes_from_big_note).
 * Splits a long document into atomic notes based on its headings (#, ##, ###, ...).
 * Automatically writes the parent heading into the 'up' metadata property.
 * 
 * Usage:
 * 1) Interactively in a template:
 *    <%* await tp.user.createAtomicNotes(tp) -%>
 * 
 * 2) Calling with options:
 *    <%* await tp.user.createAtomicNotes(tp, {
 *        sourceFile: "Path/to/big_note.md",
 *        templateFile: "5 - Templates and Scripts/Template Notes/MyTemplate.md",
 *        existingTags: ["202610091200 - Parent Topic"],
 *        targetFolder: "" // Vault root or e.g. "1 - Rough Notes"
 *    }) -%>
 */

function deleteMetadataInString(fileStr) {
    if (!fileStr) return "";
    const normalized = fileStr.replace(/\r\n/g, "\n");
    // Removes the frontmatter at the beginning of the note (--- ... ---)
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

function addTagToFrontmatter(content, tag = "addedByCode") {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
        return `---\ntags:\n  - ${tag}\n---\n${content}`;
    }

    const frontmatter = fmMatch[1];
    // Avoid duplicate tag
    const tagPattern = new RegExp(`(^|[\\s,\\["'])${tag}(["'\\]\\s]|$)`, "i");
    if (tagPattern.test(frontmatter)) {
        return content;
    }

    // 1. Inline list: tags: [a, b] or tags: []
    const inlineListRegex = /^tags:[ \t]*\[(.*?)\][ \t]*$/m;
    if (inlineListRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(inlineListRegex, (match, inner) => {
            const trimmed = inner.trim();
            return trimmed.length > 0 ? `tags: [${trimmed}, ${tag}]` : `tags: [${tag}]`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // 2. Multiline list with existing items: tags:\n  - ...
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

    // 3. Empty tags key: tags: on its own line
    const emptyTagsRegex = /^tags:[ \t]*$/m;
    if (emptyTagsRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(emptyTagsRegex, `tags:\n  - ${tag}`);
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // 4. Single value on same line: tags: someTag
    const singleTagRegex = /^tags:[ \t]+([^\r\n\[]+)$/m;
    if (singleTagRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(singleTagRegex, (match, val) => {
            return `tags:\n  - ${val.trim()}\n  - ${tag}`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // 5. tags: key does not exist at all -> insert before closing ---
    return content.replace(/\r?\n---/, `\ntags:\n  - ${tag}\n---`);
}

function createUpperPartOfTemplate(genericTemplateStart, mytagsList, aliases = null) {
    let finalTemplate = genericTemplateStart || "";
    const timestamp = (typeof window !== "undefined" && window.moment) ? window.moment().format("DD.MM.YYYY HH:mm") : new Date().toLocaleString("de-DE");

    // 1. Timestamp ("created date:", "created date": or created date:)
    const createdDateRegex = /\n["']?created date:?["']?:?\s*.*(\n|$)/i;
    if (createdDateRegex.test(finalTemplate)) {
        finalTemplate = finalTemplate.replace(createdDateRegex, `\n"created date": ${timestamp}$1`);
    }

    // Replace Templater date placeholders, if present
    finalTemplate = finalTemplate.replaceAll('<% tp.date.now("DD.MM.YYYY HH:mm") %>', timestamp);
    finalTemplate = finalTemplate.replaceAll("<% tp.date.now('DD.MM.YYYY HH:mm') %>", timestamp);
    finalTemplate = finalTemplate.replaceAll('<%tp.date.now("DD.MM.YYYY HH:mm")%>', timestamp);
    finalTemplate = finalTemplate.replaceAll("<%tp.date.now('DD.MM.YYYY HH:mm')%>", timestamp);

    // 2. up section (instead of mytags)
    const strOfUp = (mytagsList || []).map(tag => `  - "[[${tag}]]"\n`).join("");
    if (strOfUp) {
        const regexForUpSection = /^up:[ \t]*(?:\n((?:[ \t]+-.*(?:\n|$))*))?/m;
        if (regexForUpSection.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(regexForUpSection, (match, existing) => {
                const existingLines = (existing || "")
                    .split("\n")
                    .filter(line => line.trim().length > 0 && !line.includes("<%"))
                    .map(line => line + "\n")
                    .join("");
                return `up:\n${existingLines}${strOfUp}`;
            });
        } else if (/^---\n[\s\S]*?\n---/.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(/\n---/, `\nup:\n${strOfUp}---`);
        }
    }

    // 3. Aliases section
    if (aliases && aliases.length > 0) {
        const strOfAliases = aliases.map(alias => `  - ${alias}\n`).join("");
        const regexForAliasesSection = /(\naliases:\n)([\s\S]*?)(?=^[a-zA-Z0-9_-]+:|^---|\Z)/m;

        if (regexForAliasesSection.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(regexForAliasesSection, (match, p1, p2) => {
                // Clean existing lines of unresolved Templater tags such as <% tp.file.title.split... %>
                const cleanedExisting = p2
                    .split("\n")
                    .filter(line => !line.includes("<%") && line.trim().length > 0)
                    .map(line => line + "\n")
                    .join("");
                return `${p1}${cleanedExisting}${strOfAliases}`;
            });
        } else if (/\naliases:\s*\n?/i.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(/\naliases:\s*\n?/i, `\naliases:\n${strOfAliases}`);
        } else if (/^---\n[\s\S]*?\n---/m.test(finalTemplate)) {
            finalTemplate = finalTemplate.replace(/\n---/, `\naliases:\n${strOfAliases}---`);
        }
    }

    // 4. Tags section: ensure addedByCode tag is present
    finalTemplate = addTagToFrontmatter(finalTemplate, "addedByCode");

    return finalTemplate;
}

function cleanTitle(title) {
    if (!title) return "";
    // Removes leading numbering such as "1. ", "1.1 ", "1.1.2 ", etc.
    const noStructureNumbers = title.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim();
    // Removes characters that are invalid in Obsidian file names: \ / : | # ^ [ ] * ? " < >
    const safeTitle = noStructureNumbers.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
    return safeTitle;
}

/**
 * Asks under which heading of the template the text should be inserted.
 * The text is placed directly under the chosen heading; everything after it in the template
 * follows below the text. "Directly after the metadata" keeps the template split as is.
 *
 * Options:
 *   contentHeading     - preset the heading (text without #), no prompt then
 *   askContentHeading  - false = do not prompt
 */
async function chooseContentHeading(tp, options, templateStart, templateEnd) {
    if (options.askContentHeading === false && !options.contentHeading) {
        return { templateStart, templateEnd };
    }

    // Find headings in the rest of the template (ignore code blocks)
    const headings = [];
    let offset = 0;
    let inFence = false;
    for (const line of templateEnd.split("\n")) {
        const lineEnd = offset + line.length + 1; // incl. line break
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
        } else if (!inFence) {
            const m = line.match(/^(#+)\s+(.*)$/);
            if (m) headings.push({ label: `${m[1]} ${m[2].trim()}`, title: m[2].trim(), end: lineEnd });
        }
        offset = lineEnd;
    }
    // Pure structural headings are not a target for the text -> do not offer them for selection.
    // If none remain, no prompt is shown.
    const ignoredHeadings = (options.ignoredHeadings || ["Quellen", "Source", "Übungsaufgaben", "Unterthemen"])
        .map(h => h.toLowerCase());
    const selectable = headings.filter(h => !ignoredHeadings.includes(h.title.toLowerCase()));
    if (selectable.length === 0) {
        return { templateStart, templateEnd };
    }

    let chosen = null;
    if (options.contentHeading) {
        chosen = selectable.find(h => h.title === options.contentHeading) || null;
    } else if (tp && tp.system) {
        const labels = ["(Direkt nach den Metadaten)", ...selectable.map(h => h.label)];
        const values = [null, ...selectable];
        chosen = await tp.system.suggester(labels, values, false, "Unter welcher Überschrift soll der Text eingefügt werden?");
    }
    if (!chosen) {
        return { templateStart, templateEnd };
    }

    const cut = Math.min(chosen.end, templateEnd.length);
    let head = templateEnd.substring(0, cut);
    if (!head.endsWith("\n")) head += "\n";
    return {
        templateStart: templateStart + head,
        templateEnd: templateEnd.substring(cut)
    };
}

async function resolveTemplate(app, tp, options) {
    let templateStart = "";
    let templateEnd = "";

    // A) Passed explicitly as strings
    if (typeof options.templateStart === "string") {
        templateStart = options.templateStart;
        templateEnd = typeof options.templateEnd === "string" ? options.templateEnd : "";
        return { templateStart, templateEnd };
    }

    // B) Explicit file paths
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

    // C) Single template file (TFile or path)
    let templateFile = options.templateFile;
    if (typeof templateFile === "string") {
        templateFile = app.vault.getAbstractFileByPath(templateFile);
    }

    // D) Interactive selection via suggester if not specified
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
        // Check for cursor / split marker
        const splitMarkerRegex = /<%[\s*_]*tp\.file\.cursor\([^)]*\)[\s*_]*%>|%%CONTENT%%|<!--\s*content\s*-->/i;
        const match = content.match(splitMarkerRegex);
        if (match) {
            templateStart = content.substring(0, match.index);
            templateEnd = content.substring(match.index + match[0].length);
        } else {
            // No marker: split the template at the end of the frontmatter.
            // -> Frontmatter = start, the heading's content follows directly after it,
            //    the rest of the template goes below the content.
            const normalized = content.replace(/\r\n/g, "\n");
            const fmMatch = normalized.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
            if (fmMatch) {
                templateStart = fmMatch[0].endsWith("\n") ? fmMatch[0] : fmMatch[0] + "\n";
                templateEnd = normalized.substring(fmMatch[0].length);
            } else {
                templateStart = normalized;
                templateEnd = "";
            }

            // Prompt: under which heading of the template should the text be inserted?
            const split = await chooseContentHeading(tp, options, templateStart, templateEnd);
            templateStart = split.templateStart;
            templateEnd = split.templateEnd;
        }
        return { templateStart, templateEnd };
    }

    // Fallback: default header
    templateStart = `---\n"created date:": \naliases:\nmytags:\n---\n`;
    templateEnd = "";
    return { templateStart, templateEnd };
}
/**
 * Normalizes headings in a note body so that the highest sub-heading
 * starts with '#' (level 1), keeping the relative hierarchy intact.
 * Code blocks (``` or ~~~) are protected.
 *
 * @param {string[]} bodyLines - Lines of the note body.
 * @returns {string[]} Adjusted lines.
 */
function renormalizeHeadingsInBodyLines(bodyLines) {
    if (!bodyLines || bodyLines.length === 0) return bodyLines;

    let inFence = false;
    let minLevel = Infinity;

    // First pass: find minimum heading level outside code blocks
    for (const line of bodyLines) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        const m = line.match(/^(#{1,6})\s+(.*)$/);
        if (m) {
            minLevel = Math.min(minLevel, m[1].length);
        }
    }

    if (minLevel === Infinity || minLevel <= 1) {
        return bodyLines;
    }

    const shift = minLevel - 1;
    inFence = false;

    return bodyLines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        const m = line.match(/^(#{1,6})\s+(.*)$/);
        if (m) {
            const newHashes = "#".repeat(m[1].length - shift);
            return `${newHashes} ${m[2]}`;
        }
        return line;
    });
}

function generateBlockId() {
    return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

function parseBlocksFromLines(lines) {
    const blocks = [];
    let i = 0;
    const n = lines.length;

    while (i < n) {
        const line = lines[i];

        // Empty line
        if (/^\s*$/.test(line)) {
            blocks.push({ type: "empty", lines: [line] });
            i++;
            continue;
        }

        // Horizontal divider / thematic break
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            blocks.push({ type: "divider", lines: [line] });
            i++;
            continue;
        }

        // Code block (fenced by ``` or ~~~)
        if (/^\s*(```|~~~)/.test(line)) {
            const fence = line.match(/^\s*(```|~~~)/)[1];
            const blockLines = [line];
            i++;
            while (i < n) {
                blockLines.push(lines[i]);
                if (lines[i].trim().startsWith(fence)) {
                    i++;
                    break;
                }
                i++;
            }
            let existingId = null;
            if (i < n && /^\^([a-zA-Z0-9_-]+)\s*$/.test(lines[i])) {
                existingId = lines[i].match(/^\^([a-zA-Z0-9_-]+)/)[1];
                i++;
            }
            blocks.push({ type: "code", lines: blockLines, existingId });
            continue;
        }

        // Display math block ($$ ... $$)
        if (/^\s*\$\$/.test(line)) {
            const blockLines = [line];
            i++;
            while (i < n) {
                blockLines.push(lines[i]);
                if (/^\s*\$\$/.test(lines[i])) {
                    i++;
                    break;
                }
                i++;
            }
            let existingId = null;
            if (i < n && /^\^([a-zA-Z0-9_-]+)\s*$/.test(lines[i])) {
                existingId = lines[i].match(/^\^([a-zA-Z0-9_-]+)/)[1];
                i++;
            }
            blocks.push({ type: "math", lines: blockLines, existingId });
            continue;
        }

        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            blocks.push({
                type: "heading",
                lines: [line],
                level: headingMatch[1].length,
                title: headingMatch[2].trim()
            });
            i++;
            continue;
        }

        // Markdown Table
        if (/^\s*\|/.test(line)) {
            const blockLines = [line];
            i++;
            while (i < n && /^\s*\|/.test(lines[i])) {
                blockLines.push(lines[i]);
                i++;
            }
            blocks.push({ type: "table", lines: blockLines });
            continue;
        }

        // Blockquote / Callout (> ...)
        if (/^\s*>/.test(line)) {
            const blockLines = [line];
            i++;
            while (i < n && (/^\s*>/.test(lines[i]) || (/^\s*$/.test(lines[i]) && i + 1 < n && /^\s*>/.test(lines[i + 1])))) {
                blockLines.push(lines[i]);
                i++;
            }
            blocks.push({ type: "quote", lines: blockLines });
            continue;
        }

        // List item (bulleted or numbered, including indented continuation lines)
        const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+/);
        if (listMatch) {
            const baseIndent = listMatch[1].length;
            const blockLines = [line];
            i++;
            while (i < n) {
                const nextLine = lines[i];
                if (/^\s*$/.test(nextLine)) break;
                if (/^(#{1,6})\s+/.test(nextLine)) break;
                if (/^\s*(```|~~~)/.test(nextLine)) break;
                if (/^\s*\$\$/.test(nextLine)) break;
                if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(nextLine)) break;
                const nextListMatch = nextLine.match(/^(\s*)([-*+]|\d+[.)])\s+/);
                if (nextListMatch) break;
                const nextIndent = nextLine.match(/^(\s*)/)[1].length;
                if (nextIndent > baseIndent) {
                    blockLines.push(nextLine);
                    i++;
                } else {
                    break;
                }
            }
            blocks.push({ type: "list-item", lines: blockLines });
            continue;
        }

        // Regular paragraph (contiguous non-empty lines until blank line, heading, code block, etc.)
        const blockLines = [line];
        i++;
        while (i < n) {
            const nextLine = lines[i];
            if (/^\s*$/.test(nextLine)) break;
            if (/^(#{1,6})\s+/.test(nextLine)) break;
            if (/^\s*(```|~~~)/.test(nextLine)) break;
            if (/^\s*\$\$/.test(nextLine)) break;
            if (/^\s*\|/.test(nextLine)) break;
            if (/^\s*>/.test(nextLine)) break;
            if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(nextLine)) break;
            if (/^\s*([-*+]|\d+[.)])\s+/.test(nextLine)) break;
            blockLines.push(nextLine);
            i++;
        }
        blocks.push({ type: "paragraph", lines: blockLines });
    }
    return blocks;
}

module.exports = async function (tp, options = {}) {
    const app = tp.app || window.app;

    // 1. Determine the source file
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

    // 2. Load templates (start and end)
    const { templateStart, templateEnd } = await resolveTemplate(app, tp, options);

    // 3. Determine parent topic / existingTags
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

    // 4. Target folder (default: vault root, as in the Python script)
    const targetFolder = (options.targetFolder !== undefined) ? options.targetFolder.replace(/\/+$/, "") : "";

    // 5. Read source file, preserve frontmatter, and check for headlines
    const fullSourceStr = (await app.vault.read(sourceFile)).replace(/\r\n/g, "\n");
    const fmMatch = fullSourceStr.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
    const frontmatter = fmMatch ? fmMatch[0] : "";
    const bodyStr = fullSourceStr.slice(frontmatter.length);

    try {
        checkIfStringContainsHeadlines(bodyStr);
    } catch (e) {
        new Notice(`❌ ${e.message}`);
        return;
    }

    // 6. Parse blocks and build atomic notes + overarching content
    const maxLevel = options.maxLevel !== undefined
        ? Number(options.maxLevel)
        : (options.maxHeadingLevel !== undefined ? Number(options.maxHeadingLevel) : 6);
    const useBlockReferences = options.useBlockReferences === true;
    const stopHeadings = options.stopHeadings || ["Referenz"];

    const blocks = parseBlocksFromLines(bodyStr.split("\n"));
    const currentPath = {};
    const notes = [];
    let currentNote = null;
    const usedFileNames = new Set();
    const overarchingBodyLines = [];
    let stopReached = false;

    for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];

        if (stopReached) {
            if (useBlockReferences) {
                overarchingBodyLines.push(...block.lines);
            }
            continue;
        }

        if (block.type === "heading") {
            const clean = cleanTitle(block.title);
            if (stopHeadings.includes(block.title) || stopHeadings.includes(clean)) {
                stopReached = true;
                if (useBlockReferences) {
                    overarchingBodyLines.push(...block.lines);
                }
                continue;
            }

            if (block.level <= maxLevel) {
                const timestamp = (typeof window !== "undefined" && window.moment)
                    ? window.moment().format("YYYYMMDDHHmm")
                    : (tp.date ? tp.date.now("YYYYMMDDHHmm") : "");
                const safeTitle = cleanTitle(block.title);

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

                currentPath[block.level] = currentFileName;

                // Remove all levels below current level
                for (const k of Object.keys(currentPath)) {
                    if (Number(k) > block.level) {
                        delete currentPath[k];
                    }
                }

                // Determine parent titles (all levels < block.level)
                const parentTitles = Object.keys(currentPath)
                    .map(Number)
                    .filter(k => k < block.level)
                    .sort((a, b) => a - b)
                    .map(k => currentPath[k]);

                // Direct parent heading in "up". If top level, existingTags (parent topic)
                const directParent = parentTitles.length > 0 ? [parentTitles[parentTitles.length - 1]] : (existingTags || []);
                const upList = addAliasToListOfMytags(directParent);

                let noteStartText = createUpperPartOfTemplate(templateStart, upList, [safeTitle]);

                // Replace Templater title placeholders
                noteStartText = noteStartText.replace(/<%\s*tp\.file\.title\.split\(["']\s*-\s*["']\)\[1\]\s*%>/gi, safeTitle);
                noteStartText = noteStartText.replace(/<%\s*tp\.file\.title\s*%>/gi, currentFileName);

                const filePath = targetFolder ? `${targetFolder}/${currentFileName}.md` : `${currentFileName}.md`;

                currentNote = {
                    fileName: currentFileName,
                    path: filePath,
                    startText: noteStartText,
                    bodyLines: []
                };
                notes.push(currentNote);

                if (useBlockReferences) {
                    overarchingBodyLines.push(block.lines[0]);
                }
            } else {
                // Sub-heading deeper than maxLevel
                if (currentNote) {
                    currentNote.bodyLines.push(block.lines[0]);
                }
                if (useBlockReferences) {
                    overarchingBodyLines.push(block.lines[0]);
                }
            }
            continue;
        }

        if (block.type === "empty") {
            if (currentNote) {
                const last = currentNote.bodyLines[currentNote.bodyLines.length - 1];
                if (last !== "") currentNote.bodyLines.push("");
            }
            if (useBlockReferences) {
                const last = overarchingBodyLines[overarchingBodyLines.length - 1];
                if (last !== "") overarchingBodyLines.push("");
            }
            continue;
        }

        if (block.type === "divider") {
            if (currentNote) {
                currentNote.bodyLines.push(...block.lines);
            }
            if (useBlockReferences) {
                overarchingBodyLines.push(...block.lines);
            }
            continue;
        }

        // Preamble text before any heading
        if (!currentNote) {
            if (useBlockReferences) {
                overarchingBodyLines.push(...block.lines);
            }
            continue;
        }

        // Content block (paragraph, list-item, code, math, table, quote)
        if (useBlockReferences) {
            let blockId = null;
            if (block.type === "code" || block.type === "math") {
                blockId = block.existingId || generateBlockId();
                currentNote.bodyLines.push(...block.lines, `^${blockId}`);
            } else {
                const lastLine = block.lines[block.lines.length - 1];
                const m = lastLine.match(/\s+\^([a-zA-Z0-9_-]+)$/);
                blockId = m ? m[1] : generateBlockId();
                const updatedLines = [...block.lines];
                if (!m) {
                    updatedLines[updatedLines.length - 1] = `${lastLine} ^${blockId}`;
                }
                currentNote.bodyLines.push(...updatedLines);
            }
            overarchingBodyLines.push(`![[${currentNote.fileName}#^${blockId}]]`);
        } else {
            currentNote.bodyLines.push(...block.lines);
        }
    }

    if (notes.length === 0) {
        new Notice("⚠️ Keine atomaren Notizen zum Erstellen gefunden.");
        return;
    }

    // 7. Create notes in the vault
    let createdCount = 0;
    const relevelHeadings = options.relevelHeadings !== false;

    for (const note of notes) {
        let linesToProcess = note.bodyLines;
        if (relevelHeadings) {
            linesToProcess = renormalizeHeadingsInBodyLines(linesToProcess);
        }
        let body = linesToProcess.join("\n").trim();
        let footer = "";
        if (typeof options.transformBody === "function") {
            const transformed = options.transformBody(body);
            body = transformed.text;
            footer = transformed.footer || "";
        }

        let fullText = note.startText.replace(/\n*$/, "\n");
        if (body.length > 0) {
            fullText += body + "\n";
        }
        if (templateEnd && templateEnd.trim().length > 0) {
            const stamp = (typeof window !== "undefined" && window.moment)
                ? window.moment().format("DD.MM.YYYY HH:mm")
                : (tp.date ? tp.date.now("DD.MM.YYYY HH:mm") : new Date().toLocaleString("de-DE"));
            const endText = templateEnd
                .replace(/<%\s*tp\.file\.title\.split\(["']\s*-\s*["']\)\[1\]\s*%>/gi, note.fileName.split(" - ").slice(1).join(" - "))
                .replace(/<%\s*tp\.file\.title\s*%>/gi, note.fileName)
                .replace(/<%\s*tp\.date\.now\(\s*["']DD\.MM\.YYYY HH:mm["']\s*\)\s*%>/gi, stamp);
            if (fullText) {
                fullText += "\n" + endText.replace(/^\n+/, "");
            }
        }
        if (footer) {
            fullText = fullText.replace(/\n*$/, "\n") + "\n" + footer;
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

    if (!options.silent) {
        new Notice(`✅ ${createdCount} atomare Notizen erfolgreich erstellt!`);
    }

    const overarchingContent = useBlockReferences ? frontmatter + overarchingBodyLines.join("\n") : "";

    return {
        createdCount,
        overarchingContent,
        notes
    };
};