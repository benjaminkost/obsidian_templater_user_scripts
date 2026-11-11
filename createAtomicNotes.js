/**
 * Templater User Script: createAtomicNotes
 * 
 * Converted from Python (create_notes_from_big_note).
 * Splits a long document into atomic notes based on its headings (#, ##, ###, ...).
 * Automatically writes the parent heading into the 'up' metadata property.
 * 
 * Supports using a separate template for notes matching specific words
 * (e.g. "Aufgabe", "Übung", "Definition") both interactively and via options.
 * 
 * Usage:
 * 1) Interactively in a template:
 *    <%* await tp.user.createAtomicNotes(tp) -%>
 * 
 * 2) Calling with options:
 *    <%* await tp.user.createAtomicNotes(tp, {
 *        sourceFile: "Path/to/big_note.md",
 *        templateFile: "5 - Templates and Scripts/Template Notes/MyTemplate.md",
 *        specialWords: ["Aufgabe", "Übung"],
 *        specialTemplateFile: "5 - Templates and Scripts/Template Notes/ExerciseTemplate.md",
 *        existingTags: ["202610091200 - Parent Topic"],
 *        targetFolder: "" // Vault root or e.g. "1 - Rough Notes"
 *    }) -%>
 */

function deleteMetadataInString(fileStr) {
    if (!fileStr) return "";
    const normalized = fileStr.replace(/\r\n?/g, "\n");
    // Removes the frontmatter at the beginning of the note (--- ... ---)
    return normalized.replace(/^---\n[\s\S]*?\n---\s*\n?/, "");
}

function checkIfStringContainsHeadlines(fileStr) {
    const headlineRegex = /^\s*#+\s+/m;
    if (!headlineRegex.test(fileStr)) {
        throw new Error("There has to be headlines in the document to separate it in atomic notes!");
    }
}

function addAliasToListOfMytags(mytagsList) {
    const prefixRegex = /^(\d{12})( - | )(.+)$/;
    const newMytagsList = [];
    for (let mytag of (mytagsList || [])) {
        if (!mytag) continue;
        if (typeof mytag === "object" && mytag !== null) {
            mytag = mytag.basename || mytag.name || mytag.path || "";
        }
        mytag = String(mytag).trim();
        if (!mytag || mytag === "[object Object]") continue;

        // If enclosed in [[ ... ]], strip brackets
        const linkMatch = mytag.match(/^\[\[([^\]]+)\]\]$/);
        if (linkMatch) {
            mytag = linkMatch[1].trim();
        }

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

/**
 * Adds entries from upList to the 'up:' frontmatter field of a note.
 * Avoids duplicate entries, cleans unresolved Templater tags (<% ... %>),
 * and handles multiline lists, inline lists, empty up fields, and missing up fields.
 *
 * @param {string} content - Frontmatter string or full note content starting with frontmatter.
 * @param {string[]} upList - Array of parent topic links/names (e.g. ["ParentTopic|Alias"]).
 * @returns {string} Updated content with up entries added.
 */
function addUpToFrontmatter(content, upList) {
    if (!content || !upList || upList.length === 0) return content;

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
        const items = upList.map(tag => {
            let t = String(tag).trim();
            if (t.startsWith("[[") && t.endsWith("]]")) t = t.slice(2, -2).trim();
            return `  - "[[${t}]]"`;
        }).join("\n");
        return `---\nup:\n${items}\n---\n${content}`;
    }

    let frontmatter = fmMatch[1];

    // Filter out tags that are already present in up or anywhere in frontmatter
    const tagsToAdd = [];
    for (const tag of upList) {
        if (!tag) continue;
        let cleanTag = String(tag).trim();
        if (cleanTag.startsWith("[[") && cleanTag.endsWith("]]")) {
            cleanTag = cleanTag.slice(2, -2).trim();
        }
        if (!cleanTag) continue;

        const baseTarget = cleanTag.includes("|") ? cleanTag.split("|")[0].trim() : cleanTag.trim();
        const escaped = baseTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const alreadyPresent = new RegExp(`\\[\\[${escaped}(?:[\\|#][^\\]]*)?\\]\\]`).test(frontmatter);
        if (!alreadyPresent) {
            tagsToAdd.push(cleanTag);
        }
    }

    if (tagsToAdd.length === 0) {
        return content;
    }

    const newItemsStr = tagsToAdd.map(t => `  - "[[${t}]]"`).join("\n") + "\n";

    // 1. Multiline list with existing items: up:\n  - ...
    const upMultilineRegex = /^up:[ \t]*\r?\n((?:[ \t]+-.*(?:\r?\n|$))+)/m;
    if (upMultilineRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(upMultilineRegex, (match, existing) => {
            const existingLines = (existing || "")
                .split(/\r?\n/)
                .filter(line => line.trim().length > 0 && !line.includes("<%"))
                .map(line => line + "\n")
                .join("");
            return `up:\n${existingLines}${newItemsStr}`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // 2. Inline list: up: [ ... ]
    const upInlineRegex = /^up:[ \t]*\[(.*?)\][ \t]*$/m;
    if (upInlineRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(upInlineRegex, (match, inner) => {
            const trimmed = inner.trim();
            const formattedNew = tagsToAdd.map(t => `"[[${t}]]"`).join(", ");
            return trimmed.length > 0 ? `up: [${trimmed}, ${formattedNew}]` : `up: [${formattedNew}]`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // 3. Single value on same line: up: "[[...]]" or up: [[...]]
    const upSingleRegex = /^up:[ \t]+([^\r\n\[]+)$/m;
    if (upSingleRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(upSingleRegex, (match, val) => {
            const trimmedVal = val.trim();
            if (trimmedVal.includes("<%")) {
                return `up:\n${newItemsStr.trimEnd()}`;
            }
            const formattedVal = trimmedVal.startsWith("-") ? trimmedVal : `  - ${trimmedVal}`;
            return `up:\n${formattedVal}\n${newItemsStr.trimEnd()}`;
        });
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // 4. Empty up key: up: on its own line
    const upEmptyRegex = /^up:[ \t]*$/m;
    if (upEmptyRegex.test(frontmatter)) {
        const updatedFm = frontmatter.replace(upEmptyRegex, `up:\n${newItemsStr.trimEnd()}`);
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${updatedFm}\n---`);
    }

    // 5. up key does not exist at all -> insert before closing ---
    return content.replace(/\r?\n---/, `\nup:\n${newItemsStr.trimEnd()}\n---`);
}

function createUpperPartOfTemplate(genericTemplateStart, mytagsList, aliases = null, addCodeTag = false) {
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
    finalTemplate = addUpToFrontmatter(finalTemplate, mytagsList);

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

    // 4. Tags section: optionally ensure addedByCode tag is present
    if (addCodeTag) {
        finalTemplate = addTagToFrontmatter(finalTemplate, "addedByCode");
    }

    return finalTemplate;
}

function extractReferencedNoteFromHeading(headingTitle) {
    if (!headingTitle) return null;
    const noHashes = headingTitle.replace(/^\s*#+\s*/, "");
    const withoutFootnotes = noHashes.replace(/\[\^[^\]]+\]/g, "").trim();
    const withoutLinks = withoutFootnotes.replace(/\[\[[^\]]+\]\]/g, "").trim();
    const substantiveOutside = withoutLinks.replace(/^(\d+[\.\-_)]?)+\s*/, "").replace(/^[-–—:]\s*/, "").trim();
    if (substantiveOutside) {
        // Heading contains substantive text outside the wikilink (e.g. "1. Grundlagen zu [[Thema]]")
        // It is not a pure referenced note heading.
        return null;
    }
    const match = withoutFootnotes.match(/\[\[([^\]|#]+)(?:[#|][^\]]+)?\]\]/);
    if (match) return match[1].trim();
    return null;
}

function cleanTitle(title) {
    if (!title) return "";
    // Remove leading hashes if present (allowing leading spaces)
    const noHashes = title.replace(/^\s*#+\s*/, "");
    // Remove footnote markers like [^1] or [^source]
    const withoutFootnotes = noHashes.replace(/\[\^[^\]]+\]/g, "").trim();
    // If title has a wikilink, check if there is substantive text outside the wikilink
    const withoutLinks = withoutFootnotes.replace(/\[\[[^\]]+\]\]/g, "").trim();
    const substantiveOutside = withoutLinks.replace(/^(\d+[\.\-_)]?)+\s*/, "").replace(/^[-–—:]\s*/, "").trim();
    let textToClean = substantiveOutside ? withoutLinks : "";
    if (!textToClean) {
        // Heading consisted only of a wikilink (possibly with structure numbers), e.g. "1. [[NotizName]]" or "[[NotizName|Alias]]"
        const refMatch = withoutFootnotes.match(/\[\[(?:[^\]|#]+\|)?([^\]#]+)\]\]/);
        textToClean = refMatch ? refMatch[1].trim() : withoutFootnotes;
    }
    // Removes leading numbering such as "1. ", "1.1 ", "1.1.2 ", etc.
    const noStructureNumbers = textToClean.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim();
    // Removes characters that are invalid in Obsidian file names: \ / : | # ^ [ ] * ? " < >
    const safeTitle = noStructureNumbers.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
    return safeTitle || withoutFootnotes.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim() || "Untitled";
}

/**
 * Checks whether a heading is a non-note heading (such as Quellen, Übungsaufgaben, Referenz, Unterthemen)
 * that should never trigger the creation of a new atomic note file.
 *
 * @param {string} title - Heading title to inspect.
 * @param {string[]} [stopHeadings=[]] - List of stop headings from options.
 * @returns {boolean} True if the heading should never generate an atomic note file.
 */
function isNonNoteHeading(title, stopHeadings = []) {
    if (!title) return false;
    const clean = cleanTitle(title).toLowerCase();
    const noNum = clean.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim().toLowerCase();

    // Built-in non-note headings
    const builtInNonNotes = ["quellen", "übungsaufgaben", "uebungsaufgaben", "referenz", "unterthemen"];
    if (builtInNonNotes.includes(clean) || builtInNonNotes.includes(noNum)) {
        return true;
    }

    // Custom stopHeadings
    for (const sh of stopHeadings) {
        if (!sh) continue;
        const shClean = cleanTitle(sh).toLowerCase();
        const shNoNum = shClean.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim().toLowerCase();
        if (clean === shClean || noNum === shNoNum || title.trim().toLowerCase() === sh.trim().toLowerCase()) {
            return true;
        }
    }

    return false;
}

/**
 * Finds the character offset in text where the first stop section
 * (# Übungsaufgaben or # Quellen) begins outside code blocks.
 *
 * @param {string} text - Markdown text to search.
 * @returns {number} Character offset, or -1 if not found.
 */
function findStopSectionIndex(text) {
    if (!text) return -1;
    const lines = text.split(/\r?\n/);
    let inFence = false;
    let charOffset = 0;

    const stopSectionRegex = /^\s*#+\s+(?:(?:\d+[\.\-_)]?)+\s*)?(?:Übungsaufgaben|uebungsaufgaben|Quellen)\b/i;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            charOffset += line.length + 1;
            continue;
        }

        if (!inFence && stopSectionRegex.test(line)) {
            return charOffset;
        }

        charOffset += line.length + 1;
    }

    return -1;
}

/**
 * Finds the character offset where trailing footnote definitions begin at the end of the text.
 *
 * @param {string} text - Markdown text.
 * @returns {number} Character offset, or -1 if no trailing footnotes.
 */
function findTrailingFootnotesIndex(text) {
    if (!text) return -1;
    const lines = text.split(/\r?\n/);
    let i = lines.length - 1;
    while (i >= 0 && lines[i].trim() === "") {
        i--;
    }
    if (i < 0) return -1;

    let sawFootnote = false;
    let footnoteStartLine = -1;

    while (i >= 0) {
        const line = lines[i];
        if (line.trim() === "") {
            i--;
            continue;
        }
        if (/^\[\^([a-zA-Z0-9_-]+)\]:/.test(line)) {
            sawFootnote = true;
            footnoteStartLine = i;
            i--;
        } else if (/^\s{2,}\S/.test(line) && sawFootnote) {
            i--;
        } else {
            break;
        }
    }

    if (sawFootnote && footnoteStartLine !== -1) {
        let charOffset = 0;
        for (let l = 0; l < footnoteStartLine; l++) {
            charOffset += lines[l].length + 1;
        }
        return charOffset;
    }

    return -1;
}

/**
 * Inserts new body content into an existing note body BEFORE any '# Übungsaufgaben'
 * or '# Quellen' section. If neither section is present, appends before trailing
 * footnote definitions or at the very end.
 *
 * @param {string} preExistingBody - Existing content of the note (without frontmatter).
 * @param {string} newBody - Content to be inserted.
 * @returns {string} Combined body text.
 */
function insertContentBeforeStopSections(preExistingBody, newBody) {
    if (!newBody || newBody.trim().length === 0) {
        return preExistingBody || "";
    }
    if (!preExistingBody || preExistingBody.trim().length === 0) {
        return newBody;
    }

    const normalizedPre = preExistingBody.replace(/\r\n?/g, "\n");
    const normalizedNew = newBody.replace(/\r\n?/g, "\n").trim();

    const stopIdx = findStopSectionIndex(normalizedPre);
    if (stopIdx !== -1) {
        const before = normalizedPre.slice(0, stopIdx).trimEnd();
        const after = normalizedPre.slice(stopIdx).trimStart();
        if (before.length > 0) {
            return `${before}\n\n${normalizedNew}\n\n${after}`;
        } else {
            return `${normalizedNew}\n\n${after}`;
        }
    }

    const trailingFootnotesIdx = findTrailingFootnotesIndex(normalizedPre);
    if (trailingFootnotesIdx !== -1) {
        const before = normalizedPre.slice(0, trailingFootnotesIdx).trimEnd();
        const footnotes = normalizedPre.slice(trailingFootnotesIdx).trimStart();
        if (before.length > 0) {
            return `${before}\n\n${normalizedNew}\n\n${footnotes}`;
        } else {
            return `${normalizedNew}\n\n${footnotes}`;
        }
    }

    return `${normalizedPre.trimEnd()}\n\n${normalizedNew}`;
}

/**
 * Builds the Dataview query block for subtopics ('# Unterthemen').
 *
 * @returns {string} The formatted '# Unterthemen' block.
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


/**
 * Extracts all footnote definitions from the source text (e.g. [^1]: [[file.pdf]]).
 * Supports single-line and multi-line (indented) footnote definitions.
 *
 * @param {string} text - Full text to scan.
 * @returns {Map<string, string>} Map of footnote ID -> full definition string.
 */
function extractFootnoteDefinitions(text) {
    const definitions = new Map();
    if (!text) return definitions;

    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let currentId = null;
    let currentLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const defMatch = line.match(/^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/);
        if (defMatch) {
            if (currentId !== null) {
                definitions.set(currentId, currentLines.join("\n"));
            }
            currentId = defMatch[1];
            currentLines = [line];
        } else if (currentId !== null) {
            // Heading or another footnote definition ends the current footnote
            if (/^\s*(#{1,6})\s+/.test(line) || /^\s*\[\^([a-zA-Z0-9_-]+)\]:/.test(line)) {
                definitions.set(currentId, currentLines.join("\n"));
                currentId = null;
                currentLines = [];
                i--; // Reprocess this line on the next iteration
            } else if (/^\s*$/.test(line)) {
                // Blank line: check if next line is an indented continuation
                if (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
                    currentLines.push(line);
                } else {
                    definitions.set(currentId, currentLines.join("\n"));
                    currentId = null;
                    currentLines = [];
                }
            } else if (/^\s{2,}/.test(line)) {
                currentLines.push(line);
            } else {
                // Unindented text ends the footnote
                definitions.set(currentId, currentLines.join("\n"));
                currentId = null;
                currentLines = [];
            }
        }
    }

    if (currentId !== null) {
        definitions.set(currentId, currentLines.join("\n"));
    }

    return definitions;
}

/**
 * Finds all footnote references (e.g. [^1], [^source]) within text, ignoring definitions ([^1]:).
 *
 * @param {string} text - Text to search for footnote references.
 * @returns {string[]} List of unique footnote IDs referenced.
 */
function findFootnoteReferences(text) {
    if (!text) return [];
    const refs = new Set();
    for (const m of text.matchAll(/\[\^([a-zA-Z0-9_-]+)\](?!\s*:)/g)) {
        refs.add(m[1]);
    }
    return Array.from(refs);
}

/**
 * Collects footnote definitions needed for a note based on the footnote markers
 * present in the note's heading and body lines.
 *
 * @param {object} note - Note object with headingTitle, bodyLines, preExistingBody.
 * @param {Map<string, string>} sourceFootnoteDefs - Map of all footnote definitions in source file.
 * @param {string} currentText - Assembled text of the note so far to avoid duplicates.
 * @returns {string} String of footnote definitions to append, or empty string.
 */
function getFootnoteDefinitionsForNote(note, sourceFootnoteDefs, currentText) {
    if (!sourceFootnoteDefs || sourceFootnoteDefs.size === 0) return "";

    const combinedText = [
        note.headingTitle || "",
        ...(note.bodyLines || []),
        note.preExistingBody || "",
        currentText || ""
    ].join("\n");

    const referencedIds = findFootnoteReferences(combinedText);
    if (referencedIds.length === 0) return "";

    const neededDefs = [];
    for (const id of referencedIds) {
        const alreadyPresent = (currentText || "").includes(`[^${id}]:`);
        if (!alreadyPresent && sourceFootnoteDefs.has(id)) {
            neededDefs.push(sourceFootnoteDefs.get(id));
        }
    }

    return neededDefs.join("\n");
}

function isInsideInlineCode(line, offset) {
    const before = line.slice(0, offset);
    const count = (before.match(/`/g) || []).length;
    return count % 2 === 1;
}

/**
 * Renumbers footnotes in a text sequentially starting at 1.
 * Supports references ([^id]) and definitions ([^id]:).
 * Protects code blocks (``` / ~~~), inline code (`...`), and math blocks ($$).
 *
 * @param {string} text - The markdown content to renumber.
 * @param {string} [headerText=""] - Optional extra text (e.g. heading title) to scan for references first.
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

/**
 * Replaces references to headings (e.g. [[HeadingTitle]] or [[#HeadingTitle]])
 * with wikilinks to the created atomic note with alias (e.g. [[FileName|Alias]]).
 * Leaves code blocks, inline code, and embeds (![[...]]) untouched.
 *
 * @param {string} text - Input text.
 * @param {Map<string, object>} headingMap - Map of heading title -> { fileName, alias, sectionAnchor }.
 * @returns {string} Text with updated references.
 */
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
            const m = line.match(/^\s*(#+)\s+(.*)$/);
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
        const labels = ["(Direkt nach den Metadaten)", "❌ Vorgang abbrechen", ...selectable.map(h => h.label)];
        const values = [null, "CANCEL", ...selectable];
        chosen = await tp.system.suggester(labels, values, false, "Unter welcher Überschrift soll der Text eingefügt werden?");
        if (chosen === "CANCEL" || chosen === undefined) {
            return { cancelled: true };
        }
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
        return { templateStart, templateEnd, templateName: "Custom String" };
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
        return { templateStart, templateEnd, templateName: "File Split" };
    }

    // C) Single template file (TFile or path)
    let templateFile = options.templateFile;
    if (typeof templateFile === "string") {
        templateFile = app.vault.getAbstractFileByPath(templateFile);
    }

    // D) Interactive selection via suggester if not specified
    if (!templateFile && tp && tp.system && !options.skipPrompt && !options.skipTemplatePrompt) {
        const templateFolder = (options.templateFolder || "5 - Templates and Scripts/Template Notes").replace(/\/+$/, "");
        let templateFiles = app.vault.getMarkdownFiles()
            .filter(f => f.path.startsWith(templateFolder + "/"));

        if (templateFiles.length === 0) {
            templateFiles = app.vault.getMarkdownFiles()
                .filter(f => f.path.startsWith("5 - Templates and Scripts/") && !f.path.includes("/User Scripts/"));
        }

        if (templateFiles.length > 0) {
            const displayNames = templateFiles.map(f =>
                f.path.replace(/\.md$/, "").replace(/^5 - Templates and Scripts\/(Template Notes\/)?/, "")
            );
            const choices = ["❌ Vorgang abbrechen", "(Kein Template / Standard)", ...displayNames];
            const values = ["CANCEL", "DEFAULT", ...templateFiles];
            const promptTitle = options.promptTitle || "Welches Template möchtest du nutzen?";
            const chosen = await tp.system.suggester(choices, values, false, promptTitle);
            if (chosen === "CANCEL" || chosen === undefined) {
                return { cancelled: true };
            }
            if (chosen === "DEFAULT") {
                templateFile = null;
            } else {
                templateFile = chosen;
            }
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
            if (split.cancelled) {
                return { cancelled: true };
            }
            templateStart = split.templateStart;
            templateEnd = split.templateEnd;
        }
        return {
            templateStart,
            templateEnd,
            templateName: templateFile.basename || templateFile.name || "Template"
        };
    }

    // Fallback: default header
    templateStart = `---\n"created date:": \naliases:\nmytags:\n---\n`;
    templateEnd = "";
    return { templateStart, templateEnd, templateName: "Standard" };
}

function parseWordList(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
        return input.map(w => String(w).trim()).filter(Boolean);
    }
    return String(input)
        .split(/[,;\n]+/)
        .map(w => w.trim())
        .filter(Boolean);
}

function getTemplateForTitle(title, cleanTitle, defaultTmpl, specialTemplates = []) {
    if (!specialTemplates || specialTemplates.length === 0) {
        return defaultTmpl;
    }
    const tLower = (title || "").toLowerCase();
    const cLower = (cleanTitle || "").toLowerCase();

    for (const st of specialTemplates) {
        if (!st.words || st.words.length === 0) continue;
        const matches = st.words.some(word => {
            const w = word.trim().toLowerCase();
            return w.length > 0 && (tLower.includes(w) || cLower.includes(w));
        });
        if (matches) {
            return {
                templateStart: st.templateStart,
                templateEnd: st.templateEnd,
                templateName: st.templateName || "Separates Template"
            };
        }
    }
    return defaultTmpl;
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

        const m = line.match(/^\s*(#{1,6})\s+(.*)$/);
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

        const m = line.match(/^\s*(#{1,6})\s+(.*)$/);
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

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks whether the string is wrapped in matching array brackets `[ ... ]`.
 * Returns false for single wikilinks `[[...]]` or comma-separated wikilinks `[[A]], [[B]]`.
 *
 * @param {string} str - String to test.
 * @returns {boolean} True if wrapped in outer matching array brackets.
 */
function hasOuterArrayBrackets(str) {
    if (!str || typeof str !== "string") return false;
    const trimmed = str.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return false;

    // Single wikilink [[...]] is NOT an array
    if (/^\[\[[^\[\]\r\n]+\]\]$/.test(trimmed)) return false;

    // Single-bracket link like [Note|Alias] or [202607031507 - Note] is NOT an array
    if (/^\[[^\[\]\r\n]+\|[^\[\]\r\n]+\]$/.test(trimmed)) return false;
    if (/^\[\s*\d{8,}\s*-\s*[^\[\]\r\n]+\]$/.test(trimmed)) return false;

    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === "[") {
            depth++;
        } else if (trimmed[i] === "]") {
            depth--;
            if (depth === 0) {
                return i === trimmed.length - 1;
            }
        }
    }
    return false;
}

/**
 * Extracts individual list items from an input string or array.
 * Separates multiple wikilinks (e.g. `[[A]], [[B]]`), inline array elements,
 * or comma-separated values into distinct individual items.
 *
 * @param {string|string[]} input - Raw item, line, or array of items.
 * @returns {string[]} Array of individual list items.
 */
function extractListItems(input) {
    if (!input) return [];
    const rawList = Array.isArray(input) ? input : [input];
    const result = [];

    for (let raw of rawList) {
        if (!raw || typeof raw !== "string") continue;
        let str = raw.trim();
        if (!str) continue;

        // Strip outer quotes if inner content has multiple items or is a quoted wikilink
        if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
            const inner = str.slice(1, -1).trim();
            if (/^\[\[.*\]\]$/.test(inner) || inner.includes(",") || (/\[\[/g.test(inner) && (inner.match(/\[\[/g) || []).length > 1)) {
                str = inner;
            }
        }

        // Strip outer array brackets [ ... ] if present
        while (hasOuterArrayBrackets(str)) {
            str = str.slice(1, -1).trim();
        }

        // Find all wikilinks [[...]]
        const wikilinkMatches = Array.from(str.matchAll(/\[\[([^\]\r\n]+)\]\]/g));
        if (wikilinkMatches.length > 1) {
            // Multiple wikilinks found! Each wikilink is its own list item
            for (const m of wikilinkMatches) {
                result.push(m[0]);
            }
        } else if (wikilinkMatches.length === 1 && !str.includes(",")) {
            // Single wikilink alone
            result.push(wikilinkMatches[0][0]);
        } else if (str.includes(",")) {
            // Comma-separated list (tags or plain items)
            const split = splitInlineList(str);
            for (const s of split) {
                if (s.trim().length > 0) {
                    result.push(s.trim());
                }
            }
        } else {
            result.push(str);
        }
    }

    return result;
}

/**
 * Splits an inline YAML list string (e.g. `[item1, "item, 2", [[Note A, Part 1]]]`)
 * respecting quotes and wikilink brackets.
 *
 * @param {string} innerStr - Content inside brackets `[...]`.
 * @returns {string[]} Parsed items.
 */
function splitInlineList(innerStr) {
    if (!innerStr || typeof innerStr !== "string") return [];
    const items = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";
    let bracketDepth = 0;

    for (let i = 0; i < innerStr.length; i++) {
        const char = innerStr[i];
        if (!inQuotes && (char === '"' || char === "'")) {
            inQuotes = true;
            quoteChar = char;
            current += char;
        } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
            current += char;
        } else if (!inQuotes && char === "[" && innerStr[i + 1] === "[") {
            bracketDepth++;
            current += "[[";
            i++;
        } else if (!inQuotes && char === "]" && innerStr[i + 1] === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            current += "]]";
            i++;
        } else if (!inQuotes && bracketDepth === 0 && char === ",") {
            if (current.trim().length > 0) {
                items.push(current.trim());
            }
            current = "";
        } else {
            current += char;
        }
    }
    if (current.trim().length > 0) {
        items.push(current.trim());
    }
    return items;
}

/**
 * Formats a list item for YAML frontmatter.
 * Ensures wikilinks are properly formatted as "[[...]]" (fixing single brackets if present),
 * preserves existing quotes, and quotes strings with YAML special characters.
 *
 * @param {string} item - The item to format.
 * @returns {string} Formatted YAML list item line (e.g. `  - "[[Note]]"`).
 */
function formatListItem(item) {
    if (item === null || item === undefined) return "";
    let trimmed = String(item).trim();
    if (!trimmed) return "";

    // Strip outer quotes to inspect true content
    const unquoted = trimmed.replace(/^["'`]|["'`]$/g, "").trim();

    // 1. Single-bracketed link like [Note] or [Note|Alias] -> convert to [[Note]] / [[Note|Alias]]
    if (unquoted.startsWith("[") && !unquoted.startsWith("[[") && unquoted.endsWith("]") && !unquoted.endsWith("]]")) {
        const inner = unquoted.slice(1, -1).trim();
        if (inner.length > 0) {
            return `  - "[[${inner}]]"`;
        }
    }

    // 2. Wikilink [[...]] (whether originally quoted or not) -> ensure quoted for YAML safety: "[[...]]"
    if (/^\[\[.*\]\]$/.test(unquoted)) {
        return `  - "${unquoted}"`;
    }

    // 3. Already quoted string (non-wikilink)
    if (/^["'].*["']$/.test(trimmed)) {
        return `  - ${trimmed}`;
    }

    // 4. Contains YAML special characters -> quote it
    if (/[:\[\]{}#"',]/.test(unquoted)) {
        return `  - "${unquoted.replace(/"/g, '\\"')}"`;
    }

    return `  - ${unquoted}`;
}

/**
 * Checks whether an item already exists in a frontmatter list text block.
 *
 * @param {string} item - Item to look for (e.g. `[[Target]]` or `"tag"`).
 * @param {string} existingBlock - Text block containing the existing property/list.
 * @returns {boolean} True if already present.
 */
function isItemAlreadyInList(item, existingBlock) {
    if (!item || !existingBlock) return false;
    let trimmed = String(item).trim().replace(/^["'`]|["'`]$/g, "").trim();

    // Check wikilinks by target note name (matches both [[Target]] and [Target])
    const wikilinkMatch = trimmed.match(/^\[{1,2}([^\]|#]+)/);
    if (wikilinkMatch) {
        const target = wikilinkMatch[1].trim();
        const escaped = escapeRegex(target);
        const regex = new RegExp(`\\[{1,2}${escaped}(?:[\\|#][^\\]]*)?\\]{1,2}`, "i");
        return regex.test(existingBlock);
    }

    // Plain scalar / tag
    const clean = trimmed;
    const escaped = escapeRegex(clean);
    const regex = new RegExp(`(^|[\\s,\\["'])${escaped}(["'\\]\\s]|$)`, "i");
    return regex.test(existingBlock);
}

/**
 * Parses raw YAML lines from a section-level metadata block into structured property objects.
 * Supports multiline lists, unindented lists, inline lists, and scalar properties.
 *
 * @param {string} rawYaml - Raw YAML text between delimiters.
 * @returns {Array<{key: string, type: 'list' | 'scalar' | 'empty', items: string[], value: string, rawLines: string[]}>}
 */
function parseMetadataYaml(rawYaml) {
    if (!rawYaml || typeof rawYaml !== "string") return [];
    const lines = rawYaml.split(/\r?\n/);
    const properties = [];
    let currentProp = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip blank lines and YAML comments
        if (trimmed.length === 0 || /^#/.test(trimmed)) {
            continue;
        }

        // 1. List item (- item, * item, + item)
        const listMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
        if (listMatch) {
            const itemText = listMatch[3].trim();
            if (currentProp) {
                currentProp.type = "list";
                const extracted = extractListItems(itemText);
                if (extracted.length > 0) {
                    currentProp.items.push(...extracted);
                }
                currentProp.rawLines.push(line);
            }
            continue;
        }

        // 2. Key definition (key: or "key": or key: value)
        const keyMatch = line.match(/^(\s*)["']?([^:\r\n]+?)["']?\s*:(.*)$/);
        if (keyMatch) {
            if (currentProp) {
                properties.push(currentProp);
            }
            const key = keyMatch[2].trim();
            const rest = keyMatch[3].trim();

            currentProp = {
                key,
                type: "scalar",
                items: [],
                value: "",
                rawLines: [line]
            };

            if (rest.length === 0) {
                currentProp.type = "empty";
            } else {
                const extracted = extractListItems(rest);
                if (extracted.length > 1) {
                    currentProp.type = "list";
                    currentProp.items = extracted;
                } else if (extracted.length === 1 && /^["']?\[\[.*\]\]["']?$/.test(rest.trim())) {
                    currentProp.type = "list";
                    currentProp.items = extracted;
                    currentProp.value = extracted[0];
                } else if (hasOuterArrayBrackets(rest)) {
                    currentProp.type = "list";
                    currentProp.items = extracted;
                } else {
                    currentProp.type = "scalar";
                    currentProp.value = rest;
                }
            }
            continue;
        }

        // 3. Indented continuation line
        if (/^\s+\S/.test(line) && currentProp) {
            currentProp.rawLines.push(line);
            if (currentProp.type === "scalar" && currentProp.value) {
                currentProp.value += " " + trimmed;
            }
        }
    }

    if (currentProp) {
        properties.push(currentProp);
    }

    return properties;
}

/**
 * Checks if the line at startIdx begins a section metadata block enclosed by --- and ---.
 * Validates that every non-empty line inside contains valid YAML syntax (keys, list items, comments, or indentation),
 * and requires at least one property key definition.
 *
 * @param {string[]} lines - All lines of the document.
 * @param {number} startIdx - Index of the opening line.
 * @returns {object|null} Block object if matched, or null if regular divider / not metadata.
 */
function tryParseMetadataBlock(lines, startIdx) {
    const line = lines[startIdx];
    if (!/^\s*---+\s*$/.test(line)) return null;

    let endIdx = -1;
    for (let k = startIdx + 1; k < lines.length; k++) {
        const cur = lines[k];
        // Stop if a heading is reached before closing delimiter
        if (/^\s*#{1,6}\s+/.test(cur)) {
            return null;
        }
        if (/^\s*---+\s*$/.test(cur)) {
            endIdx = k;
            break;
        }
    }

    if (endIdx === -1) return null;

    const innerLines = lines.slice(startIdx + 1, endIdx);
    const nonEmptyLines = innerLines.filter(l => l.trim().length > 0);
    if (nonEmptyLines.length === 0) return null;

    let hasKeyDefinition = false;
    for (const l of nonEmptyLines) {
        const trimmed = l.trim();
        if (/^[-*+]\s+/.test(trimmed)) {
            // list item
        } else if (/^["']?([^:\r\n]+?)["']?\s*:(.*)/.test(trimmed)) {
            hasKeyDefinition = true;
        } else if (/^#/.test(trimmed)) {
            // comment
        } else if (/^\s+\S/.test(l)) {
            // indented continuation line
        } else {
            // Prose / regular text -> not a YAML metadata block
            return null;
        }
    }

    if (!hasKeyDefinition) return null;

    const rawYaml = innerLines.join("\n");
    const metadata = parseMetadataYaml(rawYaml);

    return {
        type: "metadata",
        lines: lines.slice(startIdx, endIdx + 1),
        rawYaml,
        metadata,
        nextIdx: endIdx + 1
    };
}

/**
 * Merges section-level metadata properties into a note's frontmatter (or note header).
 * Preserves existing frontmatter, merges list properties (like requires, required_by, down, up, tags)
 * without duplicates, fills empty keys, and adds new properties before the closing ---.
 *
 * @param {string} content - Current note startText or full note text.
 * @param {Array|string} propertiesOrYaml - Array of parsed properties or raw YAML string.
 * @returns {string} Updated content with metadata merged into frontmatter.
 */
function mergeMetadataIntoFrontmatter(content, propertiesOrYaml) {
    if (!content) content = "";
    const properties = Array.isArray(propertiesOrYaml)
        ? propertiesOrYaml
        : parseMetadataYaml(propertiesOrYaml);

    if (!properties || properties.length === 0) {
        return content;
    }

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let frontmatter = "";
    let restOfContent = "";

    if (fmMatch) {
        frontmatter = fmMatch[1];
        restOfContent = content.slice(fmMatch[0].length);
    } else {
        restOfContent = content;
    }

    for (const prop of properties) {
        const key = prop.key;
        if (!key) continue;

        const isListProp = prop.type === "list" || (prop.items && prop.items.length > 0);
        if (isListProp && prop.items && prop.items.length > 0) {
            prop.items = extractListItems(prop.items);
        }
        const escapedKey = escapeRegex(key);

        const keyLineRegex = new RegExp(`^([ \\t]*["']?${escapedKey}["']?[ \\t]*:)(.*)$`, "m");
        const keyMatch = frontmatter.match(keyLineRegex);

        if (!keyMatch) {
            // Key does not exist in frontmatter -> append before closing ---
            let propBlock = "";
            if (isListProp) {
                const formattedItems = prop.items
                    .map(it => formatListItem(it))
                    .filter(Boolean)
                    .join("\n");
                propBlock = formattedItems.length > 0 ? `${key}:\n${formattedItems}` : `${key}:`;
            } else if (prop.type === "empty") {
                propBlock = `${key}:`;
            } else {
                propBlock = `${key}: ${prop.value}`;
            }

            if (frontmatter.trim().length === 0) {
                frontmatter = propBlock;
            } else {
                frontmatter = frontmatter.replace(/\r?\n?$/, `\n${propBlock}`);
            }
            continue;
        }

        // Key exists in frontmatter
        const restOfKeyLine = keyMatch[2].trim();
        const multilineListRegex = new RegExp(
            `^([ \\t]*["']?${escapedKey}["']?[ \\t]*:[ \\t]*\\r?\\n)((?:[ \\t]+-.*(?:\\r?\\n|$))+)`,
            "m"
        );
        const multilineMatch = frontmatter.match(multilineListRegex);

        if (multilineMatch) {
            // Multiline list exists: key:\n  - item1...
            if (isListProp) {
                const existingListText = multilineMatch[2];
                const itemsToAdd = [];
                for (const it of prop.items) {
                    if (!isItemAlreadyInList(it, existingListText)) {
                        itemsToAdd.push(formatListItem(it));
                    }
                }
                if (itemsToAdd.length > 0) {
                    const addition = itemsToAdd.join("\n") + "\n";
                    frontmatter = frontmatter.replace(multilineListRegex, (m, header, listBody) => {
                        return `${header}${listBody.replace(/\r?\n?$/, "\n")}${addition}`;
                    });
                }
            }
        } else if (hasOuterArrayBrackets(restOfKeyLine) || (restOfKeyLine.startsWith("[") && restOfKeyLine.endsWith("]"))) {
            // Inline list: key: [...]
            if (isListProp) {
                const existingItems = extractListItems(restOfKeyLine);
                const itemsToAdd = [];
                for (const it of prop.items) {
                    if (!isItemAlreadyInList(it, restOfKeyLine)) {
                        itemsToAdd.push(it);
                    }
                }
                if (itemsToAdd.length > 0 || existingItems.length > 0) {
                    const allItems = [...existingItems, ...itemsToAdd]
                        .map(it => formatListItem(it))
                        .join("\n");
                    frontmatter = frontmatter.replace(keyLineRegex, `${key}:\n${allItems}`);
                }
            }
        } else if (restOfKeyLine.length === 0) {
            // Empty key: key:
            if (isListProp) {
                const formattedItems = prop.items
                    .map(it => formatListItem(it))
                    .filter(Boolean)
                    .join("\n");
                const replacement = formattedItems.length > 0 ? `${key}:\n${formattedItems}` : `${key}:`;
                frontmatter = frontmatter.replace(keyLineRegex, replacement);
            } else if (prop.type !== "empty") {
                frontmatter = frontmatter.replace(keyLineRegex, `${key}: ${prop.value}`);
            }
        } else {
            // Single scalar on the same line: key: value
            if (isListProp) {
                if (restOfKeyLine.includes("<%")) {
                    const formattedItems = prop.items
                        .map(it => formatListItem(it))
                        .filter(Boolean)
                        .join("\n");
                    frontmatter = frontmatter.replace(keyLineRegex, `${key}:\n${formattedItems}`);
                } else {
                    const existingItems = extractListItems(restOfKeyLine);
                    const itemsToAdd = [];
                    for (const it of prop.items) {
                        if (!isItemAlreadyInList(it, restOfKeyLine)) {
                            itemsToAdd.push(it);
                        }
                    }
                    const allItems = [...existingItems, ...itemsToAdd]
                        .map(it => formatListItem(it))
                        .join("\n");
                    frontmatter = frontmatter.replace(keyLineRegex, `${key}:\n${allItems}`);
                }
            } else if (prop.type === "scalar") {
                frontmatter = frontmatter.replace(keyLineRegex, `${key}: ${prop.value}`);
            }
        }
    }

    const cleanFm = frontmatter.replace(/^\r?\n+|\r?\n+$/g, "");
    const cleanRest = restOfContent.replace(/^\r?\n+/, "");
    return cleanRest.length > 0
        ? `---\n${cleanFm}\n---\n${cleanRest}`
        : `---\n${cleanFm}\n---\n`;
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

        // Horizontal divider / thematic break OR Section metadata block (--- ... ---)
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            const metadataBlock = tryParseMetadataBlock(lines, i);
            if (metadataBlock) {
                blocks.push(metadataBlock);
                i = metadataBlock.nextIdx;
                continue;
            }

            blocks.push({ type: "divider", lines: [line] });
            i++;
            continue;
        }

        // Code block (fenced by ``` or ~~~)
        if (/^\s*(```|~~~)/.test(line)) {
            const fence = line.match(/^\s*(```|~~~)/)[1];
            const blockLines = [line];
            const fenceIdx = line.indexOf(fence);
            const remainder = line.slice(fenceIdx + fence.length);
            const isSingleLine = remainder.includes(fence);
            if (!isSingleLine) {
                i++;
                while (i < n) {
                    blockLines.push(lines[i]);
                    if (lines[i].trim().startsWith(fence)) {
                        i++;
                        break;
                    }
                    i++;
                }
            } else {
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
            const mathIdx = line.indexOf("$$");
            const remainder = line.slice(mathIdx + 2);
            const isSingleLine = remainder.includes("$$");
            if (!isSingleLine) {
                i++;
                while (i < n) {
                    blockLines.push(lines[i]);
                    if (/^\s*\$\$/.test(lines[i])) {
                        i++;
                        break;
                    }
                    i++;
                }
            } else {
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
        const headingMatch = line.match(/^\s*(#{1,6})\s+(.*)$/);
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
                if (/^\s*(#{1,6})\s+/.test(nextLine)) break;
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

        // Footnote definition (^[^id]: ...)
        const footnoteDefMatch = line.match(/^\s*\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/);
        if (footnoteDefMatch) {
            const blockLines = [line];
            i++;
            while (i < n) {
                const nextLine = lines[i];
                if (/^\s*$/.test(nextLine)) break;
                if (/^\s*(#{1,6})\s+/.test(nextLine)) break;
                if (/^\s*\[\^([a-zA-Z0-9_-]+)\]:/.test(nextLine)) break;
                if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(nextLine)) break;
                blockLines.push(nextLine);
                i++;
            }
            blocks.push({ type: "footnote-def", id: footnoteDefMatch[1], lines: blockLines });
            continue;
        }

        // Regular paragraph (contiguous non-empty lines until blank line, heading, code block, etc.)
        const blockLines = [line];
        i++;
        while (i < n) {
            const nextLine = lines[i];
            if (/^\s*$/.test(nextLine)) break;
            if (/^\s*(#{1,6})\s+/.test(nextLine)) break;
            if (/^\s*(```|~~~)/.test(nextLine)) break;
            if (/^\s*\$\$/.test(nextLine)) break;
            if (/^\s*\|/.test(nextLine)) break;
            if (/^\s*>/.test(nextLine)) break;
            if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(nextLine)) break;
            if (/^\s*([-*+]|\d+[.)])\s+/.test(nextLine)) break;
            if (/^\s*\[\^([a-zA-Z0-9_-]+)\]:/.test(nextLine)) break;
            blockLines.push(nextLine);
            i++;
        }
        blocks.push({ type: "paragraph", lines: blockLines });
    }
    return blocks;
}

function createAtomicNotes(tp, options = {}) {
    const promise = (async () => {
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
            const displayNames = ["❌ Vorgang abbrechen", ...allMarkdownFiles.map(f => f.basename)];
            const values = ["CANCEL", ...allMarkdownFiles];
            const chosenSource = await tp.system.suggester(displayNames, values, false, "Welche Notiz soll aufgeteilt werden?");
            if (chosenSource === "CANCEL" || chosenSource === undefined || chosenSource === null) {
                new Notice("Abgebrochen: Vorgang abgebrochen.");
                return "";
            }
            sourceFile = chosenSource;
        }

        if (!sourceFile) {
            new Notice("Abgebrochen: Keine Quelldatei gefunden oder ausgewählt!");
            return "";
        }

        // 2. Load templates (start and end)
        const resolvedTmpl = await resolveTemplate(app, tp, options);
        if (resolvedTmpl.cancelled) {
            new Notice("Abgebrochen: Vorgang abgebrochen.");
            return "";
        }
        const { templateStart, templateEnd } = resolvedTmpl;

        // 2b. Special templates for specific words
        const specialTemplates = [];

        // Check if keywordTemplates passed in options:
        // [ { words: ["Aufgabe", "Übung"], templateFile: "..." }, ... ]
        if (Array.isArray(options.keywordTemplates)) {
            for (const item of options.keywordTemplates) {
                const words = parseWordList(item.words);
                if (words.length === 0) continue;
                const tmpl = await resolveTemplate(app, tp, {
                    ...options,
                    templateFile: item.templateFile || item.file,
                    templateStart: item.templateStart,
                    templateEnd: item.templateEnd,
                    skipPrompt: true,
                    skipTemplatePrompt: true
                });
                if (!tmpl.cancelled) {
                    specialTemplates.push({
                        words,
                        templateStart: tmpl.templateStart,
                        templateEnd: tmpl.templateEnd,
                        templateName: tmpl.templateName
                    });
                }
            }
        }

        // Check if specialWords passed in options:
        const optSpecialWords = options.specialWords || options.customTemplateWords;
        if (optSpecialWords && (!options.keywordTemplates || options.keywordTemplates.length === 0)) {
            const words = parseWordList(optSpecialWords);
            if (words.length > 0) {
                const sepFile = options.specialTemplateFile || options.specialTemplate || options.customTemplateFile;
                const tmpl = await resolveTemplate(app, tp, {
                    ...options,
                    templateFile: sepFile,
                    promptTitle: `Welches separate Template soll für '${words.join(", ")}' genutzt werden?`,
                    skipPrompt: Boolean(options.skipPrompt || sepFile),
                    skipTemplatePrompt: Boolean(options.skipPrompt || sepFile)
                });
                if (tmpl.cancelled) {
                    new Notice("Abgebrochen: Vorgang abgebrochen.");
                    return "";
                }
                specialTemplates.push({
                    words,
                    templateStart: tmpl.templateStart,
                    templateEnd: tmpl.templateEnd,
                    templateName: tmpl.templateName
                });
            }
        }

        // Interactive prompt for specific words if not supplied in options
        if (
            specialTemplates.length === 0 &&
            options.askSpecialTemplate !== false &&
            !options.specialWords &&
            !options.customTemplateWords &&
            !options.keywordTemplates &&
            tp && tp.system && typeof tp.system.prompt === "function" &&
            !options.skipPrompt
        ) {
            const wordsPrompt = await tp.system.prompt(
                "Spezifische Wörter für separates Template (optional, kommagetrennt - Enter für keines):",
                ""
            );
            if (wordsPrompt === null) {
                new Notice("Abgebrochen: Vorgang abgebrochen.");
                return "";
            }
            const words = parseWordList(wordsPrompt);
            if (words.length > 0) {
                let continueAdding = true;
                let currentWords = words;

                while (continueAdding) {
                    const sepTmpl = await resolveTemplate(app, tp, {
                        ...options,
                        templateFile: null,
                        templateStart: null,
                        templateEnd: null,
                        templateStartFile: null,
                        templateEndFile: null,
                        promptTitle: `Welches separate Template soll für '${currentWords.join(", ")}' genutzt werden?`
                    });

                    if (sepTmpl.cancelled) {
                        new Notice("Abgebrochen: Vorgang abgebrochen.");
                        return "";
                    }

                    specialTemplates.push({
                        words: currentWords,
                        templateStart: sepTmpl.templateStart,
                        templateEnd: sepTmpl.templateEnd,
                        templateName: sepTmpl.templateName
                    });

                    // Ask if user wants to add another template for other words
                    if (typeof tp.system.suggester === "function") {
                        const moreChoices = [
                            "Nein, weiter [Standard]",
                            "Ja, weitere Wörter & Template hinzufügen",
                            "❌ Vorgang abbrechen"
                        ];
                        const moreValues = [false, true, "CANCEL"];
                        const moreChosen = await tp.system.suggester(
                            moreChoices,
                            moreValues,
                            false,
                            "Möchtest du für weitere Wörter noch ein separates Template festlegen?"
                        );
                        if (moreChosen === "CANCEL" || moreChosen === undefined) {
                            new Notice("Abgebrochen: Vorgang abgebrochen.");
                            return "";
                        }
                        if (moreChosen === true) {
                            const nextWordsPrompt = await tp.system.prompt(
                                "Gib weitere spezifische Wörter ein (kommagetrennt):",
                                ""
                            );
                            if (nextWordsPrompt === null) {
                                new Notice("Abgebrochen: Vorgang abgebrochen.");
                                return "";
                            }
                            const nextWords = parseWordList(nextWordsPrompt);
                            if (nextWords.length === 0) {
                                continueAdding = false;
                            } else {
                                currentWords = nextWords;
                            }
                        } else {
                            continueAdding = false;
                        }
                    } else {
                        continueAdding = false;
                    }
                }
            }
        }

        // 3. Determine parent topic / existingTags
        let existingTags = options.existingTags || [];
        if (!Array.isArray(existingTags)) {
            existingTags = [existingTags];
        }
        existingTags = existingTags
            .filter(t => t !== null && t !== undefined)
            .map(t => (typeof t === "object" ? (t.basename || t.name || t.path || "") : String(t)))
            .filter(t => t.length > 0 && t !== "[object Object]");

        if (existingTags.length === 0 && tp.system && !options.skipPrompt) {
            const allNotes = app.vault.getMarkdownFiles();
            const displayAllNotes = ["(Kein Oberthema)", "❌ Vorgang abbrechen", ...allNotes.map(f => f.basename)];
            const values = ["NONE", "CANCEL", ...allNotes];

            const chosenUp = await tp.system.suggester(displayAllNotes, values, false, "Welchem Oberthema sollen die erstellten Notes zugeordnet werden? (Optional)");
            if (chosenUp === "CANCEL" || chosenUp === undefined) {
                new Notice("Abgebrochen: Vorgang abgebrochen.");
                return "";
            }
            if (chosenUp !== "NONE" && chosenUp !== null) {
                const upName = typeof chosenUp === "object" ? (chosenUp.basename || chosenUp.name || String(chosenUp)) : String(chosenUp);
                if (upName && upName !== "[object Object]") {
                    existingTags = [upName];
                }
            }
        }

        // 4. Target folder (default: vault root, as in the Python script)
        const targetFolder = (options.targetFolder !== undefined) ? options.targetFolder.replace(/\/+$/, "") : "";

        // 5. Read source file, preserve frontmatter, and check for headlines
        const fullSourceStr = (await app.vault.read(sourceFile)).replace(/\r\n?/g, "\n");
        const fmMatch = fullSourceStr.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
        const frontmatter = fmMatch ? fmMatch[0] : "";
        const bodyStr = fullSourceStr.slice(frontmatter.length);
        const sourceFootnoteDefs = extractFootnoteDefinitions(fullSourceStr);

        try {
            checkIfStringContainsHeadlines(bodyStr);
        } catch (e) {
            new Notice(`❌ ${e.message}`);
            return "";
        }

    // 6. Parse blocks and build atomic notes + overarching content
    const maxLevel = options.maxLevel !== undefined
        ? Number(options.maxLevel)
        : (options.maxHeadingLevel !== undefined ? Number(options.maxHeadingLevel) : 6);
    const useBlockReferences = options.useBlockReferences === true;
    const stopHeadings = options.stopHeadings || ["Quellen", "Übungsaufgaben", "Referenz", "Unterthemen"];
    let addCodeTag = false;
    if (options.addCodeTag !== undefined) {
        addCodeTag = Boolean(options.addCodeTag);
    } else if (options.addAddedByCode !== undefined) {
        addCodeTag = Boolean(options.addAddedByCode);
    } else if (options.askCodeTag && tp.system) {
        const tagChoices = [
            "Ohne Tag 'addedByCode' [Standard]",
            "Mit Tag 'addedByCode'",
            "❌ Vorgang abbrechen"
        ];
        const tagValues = [false, true, "CANCEL"];
        const chosenTag = await tp.system.suggester(tagChoices, tagValues, false, "Soll der Tag 'addedByCode' hinzugefügt werden?");
        if (chosenTag === "CANCEL" || chosenTag === undefined) {
            new Notice("Abgebrochen: Vorgang abgebrochen.");
            return "";
        }
        addCodeTag = chosenTag;
    }

    const blocks = parseBlocksFromLines(bodyStr.split("\n"));
    let minHeadingLevel = 6;
    for (const b of blocks) {
        if (b.type === "heading" && b.level < minHeadingLevel) {
            minHeadingLevel = b.level;
        }
    }

    const currentPath = {};
    const notes = [];
    let currentNote = null;
    let currentTopicLevel = 0;
    const usedFileNames = new Set();
    const overarchingBodyLines = [];
    const headingMap = new Map();
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
            const isNonNote = isNonNoteHeading(block.title, stopHeadings);

            if (isNonNote && (block.level <= minHeadingLevel || (currentTopicLevel > 0 && block.level <= currentTopicLevel))) {
                stopReached = true;
                if (useBlockReferences) {
                    overarchingBodyLines.push(...block.lines);
                }
                continue;
            }

            const referencedNote = extractReferencedNoteFromHeading(block.title);
            const shouldCreateOrUseNote = !isNonNote && (referencedNote || (block.level <= maxLevel));

            if (shouldCreateOrUseNote) {
                currentTopicLevel = block.level;
                const safeTitle = cleanTitle(block.title);
                let currentFileName = "";
                let isReferenced = false;
                let existingFile = null;

                if (referencedNote) {
                    currentFileName = referencedNote;
                    isReferenced = true;

                    // Try to locate existing file in vault
                    if (app?.metadataCache?.getFirstLinkpathDest) {
                        existingFile = app.metadataCache.getFirstLinkpathDest(referencedNote, "");
                    }
                    if (!existingFile && app?.vault?.getAbstractFileByPath) {
                        existingFile = app.vault.getAbstractFileByPath(
                            targetFolder ? `${targetFolder}/${referencedNote}.md` : `${referencedNote}.md`
                        ) || app.vault.getAbstractFileByPath(`${referencedNote}.md`);
                    }
                    if (!existingFile && app?.vault?.getMarkdownFiles) {
                        existingFile = app.vault.getMarkdownFiles().find(f => f.basename === referencedNote);
                    }
                } else {
                    const timestamp = (typeof window !== "undefined" && window.moment)
                        ? window.moment().format("YYYYMMDDHHmm")
                        : (tp.date ? tp.date.now("YYYYMMDDHHmm") : "");

                    currentFileName = timestamp ? `${timestamp} - ${safeTitle}` : safeTitle;
                    let counter = 1;
                    while (
                        usedFileNames.has(currentFileName) ||
                        app.vault.getAbstractFileByPath(targetFolder ? `${targetFolder}/${currentFileName}.md` : `${currentFileName}.md`)
                    ) {
                        currentFileName = timestamp ? `${timestamp} - ${safeTitle} (${counter})` : `${safeTitle} (${counter})`;
                        counter++;
                    }
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

                // Mark parent note as having subheadings
                if (parentTitles.length > 0) {
                    const directParentFileName = parentTitles[parentTitles.length - 1];
                    const parentNote = notes.find(n => n.fileName === directParentFileName);
                    if (parentNote) {
                        parentNote.hasSubheadings = true;
                    }
                }

                // Check if note already exists in this run's notes list (only merge if it was an explicit referenced note heading)
                let existingNoteEntry = isReferenced ? notes.find(n => n.fileName === currentFileName) : null;
                if (existingNoteEntry) {
                    currentNote = existingNoteEntry;
                    currentNote.headingTitle = (currentNote.headingTitle ? currentNote.headingTitle + "\n" : "") + block.title;
                    if (upList.length > 0) {
                        currentNote.startText = addUpToFrontmatter(currentNote.startText, upList);
                    }
                } else {
                    let noteStartText = "";
                    let preExistingBody = "";

                    const activeTemplate = getTemplateForTitle(
                        block.title,
                        safeTitle,
                        { templateStart, templateEnd },
                        specialTemplates
                    );

                    if (existingFile) {
                        const existingContent = (await app.vault.read(existingFile)).replace(/\r\n?/g, "\n");
                        const fmMatch = existingContent.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
                        if (fmMatch) {
                            noteStartText = addUpToFrontmatter(fmMatch[0], upList);
                            preExistingBody = existingContent.slice(fmMatch[0].length).trim();
                        } else {
                            noteStartText = createUpperPartOfTemplate(activeTemplate.templateStart, upList, [safeTitle], addCodeTag);
                            preExistingBody = existingContent.trim();
                        }
                    } else {
                        noteStartText = createUpperPartOfTemplate(activeTemplate.templateStart, upList, [safeTitle], addCodeTag);

                        // Replace Templater title placeholders
                        noteStartText = noteStartText.replace(/<%\s*tp\.file\.title\.split\(["']\s*-\s*["']\)\[1\]\s*%>/gi, safeTitle);
                        noteStartText = noteStartText.replace(/<%\s*tp\.file\.title\s*%>/gi, currentFileName);
                    }

                    const filePath = existingFile
                        ? existingFile.path
                        : (targetFolder ? `${targetFolder}/${currentFileName}.md` : `${currentFileName}.md`);

                    currentNote = {
                        fileName: currentFileName,
                        path: filePath,
                        fileObject: existingFile || null,
                        headingTitle: block.title,
                        startText: noteStartText,
                        preExistingBody: preExistingBody,
                        isExistingFile: !!existingFile,
                        hasSubheadings: false,
                        bodyLines: [],
                        templateEnd: activeTemplate.templateEnd
                    };
                    notes.push(currentNote);
                }

                // Map heading titles to the created/referenced note
                const headingClean = block.title.replace(/^\s*#+\s*/, "").replace(/\[\^[^\]]+\]/g, "").trim();
                const headingEntry = { fileName: currentFileName, alias: safeTitle };
                headingMap.set(safeTitle, headingEntry);
                headingMap.set(headingClean, headingEntry);
                headingMap.set(block.title, headingEntry);
                if (referencedNote) {
                    headingMap.set(referencedNote, headingEntry);
                }

                if (useBlockReferences) {
                    overarchingBodyLines.push(block.lines[0]);
                }
            } else {
                // Sub-heading deeper than maxLevel
                if (currentNote) {
                    if (!isNonNote) {
                        currentNote.hasSubheadings = true;
                    }
                    currentNote.bodyLines.push(block.lines[0]);
                    const subSafe = cleanTitle(block.title);
                    const subClean = block.title.replace(/^\s*#+\s*/, "").replace(/\[\^[^\]]+\]/g, "").trim();
                    const subEntry = {
                        fileName: currentNote.fileName,
                        sectionAnchor: `#${subClean}`,
                        alias: subSafe
                    };
                    headingMap.set(subSafe, subEntry);
                    headingMap.set(subClean, subEntry);
                    headingMap.set(block.title, subEntry);
                }
                if (useBlockReferences) {
                    overarchingBodyLines.push(block.lines[0]);
                }
            }
            continue;
        }

        if (block.type === "metadata") {
            if (currentNote) {
                currentNote.startText = mergeMetadataIntoFrontmatter(
                    currentNote.startText,
                    block.metadata || block.rawYaml
                );
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

        if (block.type === "footnote-def") {
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
        return "";
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

        // Replace references to headings with links to atomic notes
        body = replaceHeadingReferencesInText(body, headingMap);

        let fullText = note.startText.replace(/\n*$/, "\n");
        if (note.preExistingBody) {
            const preBodyReplaced = replaceHeadingReferencesInText(note.preExistingBody, headingMap);
            const combinedBody = insertContentBeforeStopSections(preBodyReplaced, body);
            if (combinedBody.length > 0) {
                fullText += combinedBody + "\n";
            }
        } else if (body.length > 0) {
            fullText += body + "\n";
        }

        const currentTemplateEnd = (note.templateEnd !== undefined) ? note.templateEnd : templateEnd;

        const insertUnterthemen = options.insertUnterthemen !== false && options.addUnterthemen !== false;
        if (insertUnterthemen && (note.hasSubheadings || options.forceUnterthemen === true)) {
            const hasUnterthemen = /^\s*#+\s+Unterthemen\b/m.test(fullText) ||
                                   /^\s*#+\s+Unterthemen\b/m.test(currentTemplateEnd || "");
            if (!hasUnterthemen) {
                const unterthemenBlock = (options.unterthemenBlock || buildUnterthemenBlock()).trimEnd();
                if (note.preExistingBody) {
                    const stopIdx = findStopSectionIndex(fullText);
                    if (stopIdx !== -1) {
                        const before = fullText.slice(0, stopIdx).trimEnd();
                        const after = fullText.slice(stopIdx).trimStart();
                        fullText = `${before}\n\n${unterthemenBlock}\n\n${after}\n`;
                    } else {
                        const fnIdx = findTrailingFootnotesIndex(fullText);
                        if (fnIdx !== -1) {
                            const before = fullText.slice(0, fnIdx).trimEnd();
                            const after = fullText.slice(fnIdx).trimStart();
                            fullText = `${before}\n\n${unterthemenBlock}\n\n${after}\n`;
                        } else {
                            fullText = fullText.trimEnd() + "\n\n" + unterthemenBlock + "\n";
                        }
                    }
                } else {
                    fullText = fullText.trimEnd() + "\n\n" + unterthemenBlock + "\n";
                }
            }
        }

        if ((!note.isExistingFile || !note.preExistingBody) && currentTemplateEnd && currentTemplateEnd.trim().length > 0) {
            const stamp = (typeof window !== "undefined" && window.moment)
                ? window.moment().format("DD.MM.YYYY HH:mm")
                : (tp.date ? tp.date.now("DD.MM.YYYY HH:mm") : new Date().toLocaleString("de-DE"));
            const titleWithoutPrefix = note.fileName.includes(" - ")
                ? note.fileName.split(" - ").slice(1).join(" - ")
                : note.fileName;
            const endText = currentTemplateEnd
                .replace(/<%\s*tp\.file\.title\.split\(["']\s*-\s*["']\)\[1\]\s*%>/gi, titleWithoutPrefix)
                .replace(/<%\s*tp\.file\.title\s*%>/gi, note.fileName)
                .replace(/<%\s*tp\.date\.now\(\s*["']DD\.MM\.YYYY HH:mm["']\s*\)\s*%>/gi, stamp);
            if (fullText) {
                fullText += "\n" + endText.replace(/^\n+/, "");
            }
        }
        if (footer) {
            fullText = fullText.replace(/\n*$/, "\n") + "\n" + replaceHeadingReferencesInText(footer, headingMap);
        }

        // Append transferred footnote definitions for this note
        const noteFootnotes = getFootnoteDefinitionsForNote(note, sourceFootnoteDefs, fullText);
        if (noteFootnotes) {
            fullText = fullText.replace(/\n*$/, "\n\n") + replaceHeadingReferencesInText(noteFootnotes, headingMap) + "\n";
        }

        // Final pass to ensure all heading references across the note are replaced
        fullText = replaceHeadingReferencesInText(fullText, headingMap);

        // Normalize any frontmatter list items:
        // 1) Repair single-bracket links: - "[Note|Alias]" -> - "[[Note|Alias]]"
        // 2) Split list item lines that contain multiple wikilinks into separate list items
        const fmEndMatch = fullText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmEndMatch) {
            const rawFm = fmEndMatch[0];
            const fixedLines = [];
            for (const line of rawFm.split(/\r?\n/)) {
                const listMatch = line.match(/^(\s*-\s*)(.*)$/);
                if (listMatch) {
                    const prefix = listMatch[1];
                    const content = listMatch[2].trim();
                    const wikilinks = Array.from(content.matchAll(/\[\[([^\]\r\n]+)\]\]/g));

                    if (wikilinks.length > 1) {
                        for (const w of wikilinks) {
                            fixedLines.push(`${prefix}"${w[0]}"`);
                        }
                        continue;
                    }

                    // Single-bracket link repair: - "[Note|Alias]" -> - "[[Note|Alias]]"
                    const singleBracketMatch = content.match(/^["'`]?\[([^\[\]\r\n]+)\]["'`]?$/);
                    if (singleBracketMatch) {
                        fixedLines.push(`${prefix}"[[${singleBracketMatch[1]}]]"`);
                        continue;
                    }
                }
                fixedLines.push(line);
            }
            const fixedFm = fixedLines.join("\n");
            if (fixedFm !== rawFm) {
                fullText = fixedFm + fullText.slice(rawFm.length);
            }
        }

        // Renumber footnotes so that each created note starts numbering at 1
        fullText = renumberFootnotesInText(fullText, note.headingTitle);

        try {
            const fileToWrite = note.fileObject || app.vault.getAbstractFileByPath(note.path);
            if (fileToWrite) {
                await app.vault.modify(fileToWrite, fullText);
            } else {
                await app.vault.create(note.path, fullText);
            }
            createdCount++;
        } catch (err) {
            console.error(`Fehler beim Erstellen der Notiz '${note.path}':`, err);
        }
    }

    if (!options.silent) {
        if (typeof Notice !== "undefined") {
            new Notice(`✅ ${createdCount} atomare Notizen erfolgreich erstellt!`);
        } else {
            console.log(`[Notice] ✅ ${createdCount} atomare Notizen erfolgreich erstellt!`);
        }
    }

    const overarchingContent = useBlockReferences
        ? renumberFootnotesInText(replaceHeadingReferencesInText(frontmatter + overarchingBodyLines.join("\n"), headingMap))
        : "";

        const result = {
            createdCount,
            overarchingContent,
            notes,
            headingMap,
            toString() {
                return "";
            },
            valueOf() {
                return "";
            },
            [Symbol.toPrimitive](hint) {
                return "";
            },
            toJSON() {
                return "";
            }
        };

        return result;
    })();

    // In case the function is called without await in a Templater interpolated tag: <% tp.user.createAtomicNotes(tp) %>
    promise.toString = () => "";
    promise.valueOf = () => "";
    if (typeof Symbol !== "undefined" && Symbol.toPrimitive) {
        promise[Symbol.toPrimitive] = () => "";
    }

    return promise;
}

module.exports = createAtomicNotes;

module.exports.isNonNoteHeading = isNonNoteHeading;
module.exports.insertContentBeforeStopSections = insertContentBeforeStopSections;
module.exports.replaceHeadingReferencesInText = replaceHeadingReferencesInText;
module.exports.cleanTitle = cleanTitle;
module.exports.renumberFootnotesInText = renumberFootnotesInText;
module.exports.addUpToFrontmatter = addUpToFrontmatter;
module.exports.buildUnterthemenBlock = buildUnterthemenBlock;
module.exports.getTemplateForTitle = getTemplateForTitle;
module.exports.parseWordList = parseWordList;
module.exports.resolveTemplate = resolveTemplate;
module.exports.tryParseMetadataBlock = tryParseMetadataBlock;
module.exports.parseMetadataYaml = parseMetadataYaml;
module.exports.mergeMetadataIntoFrontmatter = mergeMetadataIntoFrontmatter;
module.exports.formatListItem = formatListItem;
module.exports.extractListItems = extractListItems;
module.exports.hasOuterArrayBrackets = hasOuterArrayBrackets;
