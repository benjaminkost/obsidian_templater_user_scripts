/**
 * Templater User Script: createPdfFromTopics
 *
 * Generates a comprehensive, publication-ready summary document and exports it to PDF.
 *
 * Input:
 *   - Summary (Zusammenfassung): Provided via existing note, manual text prompt, active note, or options.
 *   - Overarching Topic Notes (Oberthemen Notes): One or multiple parent notes selected via suggester or options.
 *
 * Output:
 *   PDF / Markdown Document containing:
 *   1. Summary (Zusammenfassung)
 *   2. Clickable Table of Contents / Outline (clickable Gliederung in Hierarchie entsprechend
 *      der Metadaten Tags + In Klammern die required Notes)
 *   3. All Notes arranged sequentially according to the hierarchical outline (Notes entsprechend der Gliederung)
 *
 * Usage in Templater:
 *   <%* await tp.user.createPdfFromTopics(tp) -%>
 *
 * Options (optional):
 *   summary          - Text string or TFile/path of a summary note
 *   oberthemenNotes  - Array of TFile objects, paths, or basenames of overarching notes
 *   targetFolder     - Folder where the compiled markdown file is created (default: same as first Oberthema or root)
 *   fileName         - Custom filename for the output note
 *   openPdfDialog    - boolean (default: true) to trigger Obsidian's native "Export to PDF" dialog
 *   tocTitle         - Heading title for Table of Contents (default: "Gliederung")
 *   summaryTitle     - Heading title for Summary (default: "Zusammenfassung")
 *   numberHeadings   - boolean (default: true) to prefix headings with hierarchical numbers (e.g. 1., 1.1)
 */

/**
 * Removes leading and trailing whitespace, structure numbers, footnotes,
 * and cleans illegal characters from title strings.
 *
 * @param {string} title - Raw title string.
 * @returns {string} Sanitized title.
 */
function cleanTitle(title) {
    if (!title) return "";
    const noHashes = title.replace(/^\s*#+\s*/, "");
    const withoutFootnotes = noHashes.replace(/\[\^[^\]]+\]/g, "").trim();
    const withoutLinks = withoutFootnotes.replace(/\[\[[^\]]+\]\]/g, "").trim();
    const substantiveOutside = withoutLinks.replace(/^(\d+[\.\-_)]?)+\s*/, "").replace(/^[-–—:]\s*/, "").trim();
    let textToClean = substantiveOutside ? withoutLinks : "";
    if (!textToClean) {
        // Extract note name from [[Target|Alias]]
        const refMatch = withoutFootnotes.match(/\[\[(?:([^\]|#]+)\|)?([^\]#]+)\]\]/);
        textToClean = refMatch ? (refMatch[1] || refMatch[2]).trim() : withoutFootnotes;
    }
    const noStructureNumbers = textToClean.replace(/^(\d+[\.\-_)]?)+\s*/, "").trim();
    const safeTitle = noStructureNumbers.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
    return safeTitle || withoutFootnotes.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim() || "Untitled";
}

/**
 * Strips YAML frontmatter (--- ... ---) from the beginning of markdown content.
 *
 * @param {string} fileStr - Markdown content.
 * @returns {string} Body without frontmatter.
 */
function deleteMetadataInString(fileStr) {
    if (!fileStr) return "";
    const normalized = fileStr.replace(/\r\n?/g, "\n");
    return normalized.replace(/^---\n[\s\S]*?\n---[ \t]*\n?/, "");
}

/**
 * Removes '# Unterthemen' and associated Dataview code blocks from note content.
 * In a static combined export/PDF, raw dataview blocks are redundant and unrendered.
 *
 * @param {string} text - Markdown body text.
 * @returns {string} Cleaned text without '# Unterthemen' block.
 */
function stripUnterthemenSection(text) {
    if (!text) return "";
    // Matches '#+ Unterthemen' through the closing dataview code block or next heading
    return text.replace(
        /^\s*#+\s+Unterthemen\b[\s\S]*?(?:```\s*(?:\r?\n|$)|(?=^\s*#+\s|\Z))/m,
        ""
    ).trim();
}

/**
 * Normalizes an anchor ID so it can be safely used in internal markdown links.
 *
 * @param {string} str - Anchor string or heading.
 * @returns {string} Clean anchor slug.
 */
function slugifyAnchor(str) {
    if (!str) return "";
    return str
        .toLowerCase()
        .replace(/[^\w\d\-_]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Extracts targets/links from frontmatter values or inline fields.
 *
 * @param {*} val - Value from parsed frontmatter or inline text.
 * @returns {string[]} Array of clean note basenames/paths.
 */
function extractLinksFromValue(val) {
    const targets = [];

    function addRaw(v) {
        if (!v) return;
        if (Array.isArray(v)) {
            v.forEach(addRaw);
            return;
        }
        if (typeof v === "object") {
            const name = v.basename || v.name || v.path || "";
            if (name) addRaw(name);
            return;
        }
        const str = String(v).trim();
        if (!str || str === "[object Object]") return;

        // Check for wikilinks [[Target|Alias]] or [[Target#Heading|Alias]]
        const wikiMatches = [...str.matchAll(/\[\[([^\]]+)\]\]/g)];
        if (wikiMatches.length > 0) {
            for (const m of wikiMatches) {
                let link = m[1].trim();
                if (link.includes("|")) link = link.split("|")[0].trim();
                if (link.includes("#")) link = link.split("#")[0].trim();
                if (link && !targets.includes(link)) {
                    targets.push(link);
                }
            }
        } else {
            // Split by comma or semicolon if multiple values
            const parts = str.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
            for (const p of parts) {
                let clean = p.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
                clean = clean.replace(/^[-*+]\s+/, "").trim();
                if (clean && !targets.includes(clean)) {
                    targets.push(clean);
                }
            }
        }
    }

    addRaw(val);
    return targets;
}

/**
 * Extracts links for specific metadata keys from frontmatter and inline content.
 * Strictly checks only the provided keys (never checking unrelated fields like 'next' or 'prev').
 *
 * @param {object|null} frontmatter - Parsed frontmatter properties.
 * @param {string[]} keys - Allowed metadata property names (e.g. ['up', 'parent']).
 * @param {string} [content=""] - Note content.
 * @returns {string[]} Array of extracted links.
 */
function extractLinksForKeys(frontmatter, keys, content = "") {
    const result = [];
    const lowerKeys = keys.map(k => k.toLowerCase());

    function addTargets(targets) {
        for (const t of targets) {
            if (t && !result.includes(t)) {
                result.push(t);
            }
        }
    }

    // 1. Check parsed frontmatter object
    if (frontmatter && typeof frontmatter === "object") {
        for (const [propKey, propVal] of Object.entries(frontmatter)) {
            if (lowerKeys.includes(propKey.toLowerCase())) {
                addTargets(extractLinksFromValue(propVal));
            }
        }
    }

    // 2. Check frontmatter text in content (as a backup if cache hasn't parsed YAML yet)
    if (content) {
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
            const fmText = fmMatch[1];
            for (const k of keys) {
                const keyRegex = new RegExp("^" + k + ":[ \\t]*(.*(?:\\r?\\n[ \\t]+-.*)*)", "im");
                const m = fmText.match(keyRegex);
                if (m && m[1]) {
                    addTargets(extractLinksFromValue(m[1]));
                }
            }
        }

        // 3. Check Dataview inline fields in content body: [key:: ...] or key:: ...
        // and bold fields: **Key:** ...
        const lines = content.replace(/\r\n?/g, "\n").split("\n");
        const keyPattern = keys.join("|");
        const bracketRegex = new RegExp("\\[(?:" + keyPattern + ")::\\s*(.+?)\\](?=[^\\]]*$)", "i");
        const lineRegex = new RegExp("^\\s*(?:" + keyPattern + ")::\\s*(.+)$", "i");
        const boldRegex = new RegExp("\\*\\*(?:" + keyPattern + "):\\*\\*\\s*(.+)$", "i");

        for (const line of lines) {
            const bMatch = line.match(bracketRegex);
            if (bMatch) {
                addTargets(extractLinksFromValue(bMatch[1]));
            } else {
                const lMatch = line.match(lineRegex);
                if (lMatch) {
                    addTargets(extractLinksFromValue(lMatch[1]));
                }
            }
            const boldMatch = line.match(boldRegex);
            if (boldMatch) {
                addTargets(extractLinksFromValue(boldMatch[1]));
            }
        }
    }

    return result;
}

/**
 * Extracts 'up' (parent) links strictly from 'up', 'parent', 'mytags'.
 */
function extractUpLinks(frontmatter, content = "") {
    return extractLinksForKeys(frontmatter, ["up", "parent", "mytags"], content);
}

/**
 * Extracts 'down' (children/subtopics) links strictly from 'down', 'children', 'subtopics', 'unterthemen'.
 */
function extractDownLinks(frontmatter, content = "") {
    return extractLinksForKeys(frontmatter, ["down", "children", "subtopics", "unterthemen"], content);
}

/**
 * Extracts 'requires' (prerequisites) links strictly from 'requires', 'required', 'requirements', 'prerequisites', 'voraussetzungen', 'benoetigt'.
 */
function extractRequiresLinks(frontmatter, content = "") {
    return extractLinksForKeys(frontmatter, [
        "requires",
        "required",
        "requirements",
        "required_notes",
        "required notes",
        "required Notes",
        "Required Notes",
        "prerequisites",
        "prerequisite",
        "voraussetzungen",
        "voraussetzung",
        "benoetigt"
    ], content);
}

/**
 * Extracts 'required_by' (inverse prerequisites) links strictly from 'required_by', 'requiredBy', 'benoetigt_von', 'benötigt_von'.
 */
function extractRequiredByLinks(frontmatter, content = "") {
    return extractLinksForKeys(frontmatter, [
        "required_by",
        "required by",
        "requiredBy",
        "Required By",
        "benoetigt_von",
        "benötigt_von"
    ], content);
}

/**
 * Backward compatibility alias for extractUpLinks.
 */
function extractParentLinks(frontmatter, cache, content = "") {
    return extractUpLinks(frontmatter, content);
}

/**
 * Backward compatibility alias for extractRequiresLinks.
 */
function extractRequiredNotes(frontmatter, content = "") {
    return extractRequiresLinks(frontmatter, content);
}

/**
 * Checks whether note B has targetFile as a link.
 *
 * @param {string[]} parentLinks - Parent links extracted from note B.
 * @param {TFile} targetFile - Parent candidate file A.
 * @returns {boolean} True if note B points to targetFile.
 */
function isChildOf(parentLinks, targetFile) {
    if (!parentLinks || parentLinks.length === 0 || !targetFile) return false;
    const base = targetFile.basename || "";
    const path = targetFile.path || "";
    const name = targetFile.name || "";

    for (let link of parentLinks) {
        link = String(link).trim();
        if (link.startsWith("[[") && link.endsWith("]]")) {
            link = link.slice(2, -2).trim();
        }
        if (link.includes("|")) link = link.split("|")[0].trim();
        if (link.includes("#")) link = link.split("#")[0].trim();

        if (
            link === base ||
            link === path ||
            link === name ||
            link.endsWith("/" + base) ||
            link.endsWith("/" + name)
        ) {
            return true;
        }

        // Check cleanTitle matching (handles timestamp prefixes or structure numbers e.g. "202610261200 - Topic")
        const cleanLink = cleanTitle(link);
        const cleanBase = cleanTitle(base);
        if (cleanLink && cleanBase && cleanLink === cleanBase) {
            return true;
        }
    }
    return false;
}

/**
 * Relevels markdown headings in a note body so that its highest inner heading
 * starts below the note's hierarchical level in the document.
 * Code blocks (``` or ~~~) are protected.
 *
 * @param {string} body - Note body text.
 * @param {number} baseLevel - Level of the note heading in the document (1 = H1, 2 = H2, etc.).
 * @returns {string} Releveled markdown text.
 */
function relevelMarkdownHeadings(body, baseLevel) {
    if (!body) return "";
    const lines = body.replace(/\r\n?/g, "\n").split("\n");
    const result = [];
    let inFence = false;

    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            result.push(line);
            continue;
        }

        if (!inFence) {
            const headingMatch = line.match(/^(\s*)(#{1,6})(\s+.*)$/);
            if (headingMatch) {
                const originalLevel = headingMatch[2].length;
                // Shift inner headings so they stay strictly deeper than baseLevel
                const newLevel = Math.min(6, baseLevel + originalLevel);
                result.push(`${headingMatch[1]}${"#".repeat(newLevel)}${headingMatch[3]}`);
                continue;
            }
        }

        result.push(line);
    }

    return result.join("\n");
}

/**
 * Namespaces footnote references and definitions inside a note's body
 * by prepending a unique prefix, preventing collisions between notes.
 *
 * @param {string} text - Note body text.
 * @param {string} prefix - Unique prefix for this note.
 * @returns {string} Text with prefixed footnotes.
 */
function prefixFootnotesInNote(text, prefix) {
    if (!text) return "";
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let inFence = false;
    const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_]/g, "_");

    return lines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        const defMatch = line.match(/^(\s*\[\^)([a-zA-Z0-9_\-\.]+?)(\]:.*)$/);
        if (defMatch) {
            return `${defMatch[1]}${cleanPrefix}_${defMatch[2]}${defMatch[3]}`;
        }

        return line.replace(/\[\^([a-zA-Z0-9_\-\.]+?)\]/g, (m, id) => `[^${cleanPrefix}_${id}]`);
    }).join("\n");
}

/**
 * Renumbers footnote references and definitions across the compiled document
 * so that they start at [^1] and increase sequentially without ID collisions.
 *
 * @param {string} text - Full markdown text of compiled document.
 * @returns {string} Text with unified sequential footnotes.
 */
function renumberFootnotesAcrossDocument(text) {
    if (!text) return "";
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const oldToNew = new Map();
    let nextIndex = 1;

    // 1. First pass: find all footnote references and definitions outside fences
    let inFence = false;
    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        // References: [^id]
        const refRegex = /\[\^([a-zA-Z0-9_\-\.]+?)\]/g;
        let match;
        while ((match = refRegex.exec(line)) !== null) {
            const oldId = match[1];
            if (!oldToNew.has(oldId)) {
                oldToNew.set(oldId, String(nextIndex++));
            }
        }
    }

    if (oldToNew.size === 0) return text;

    // 2. Second pass: replace references and definitions
    inFence = false;
    const replacedLines = lines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        // Definition at line start: [^id]:
        const defMatch = line.match(/^(\s*\[\^)([a-zA-Z0-9_\-\.]+?)(\]:.*)$/);
        if (defMatch && oldToNew.has(defMatch[2])) {
            return `${defMatch[1]}${oldToNew.get(defMatch[2])}${defMatch[3]}`;
        }

        // Inline references
        return line.replace(/\[\^([a-zA-Z0-9_\-\.]+?)\]/g, (m, id) => {
            if (oldToNew.has(id)) {
                return `[^${oldToNew.get(id)}]`;
            }
            return m;
        });
    });

    return replacedLines.join("\n");
}

/**
 * Checks whether text contains structured input sections:
 * # Zusammenfassung and # Gliederung
 *
 * @param {string} content - Markdown text to inspect.
 * @returns {boolean} True if both sections are present.
 */
function hasStructuredInputSections(content) {
    if (!content) return false;
    const hasSummary = /^\s*#+\s+(?:Zusammenfassung|Summary)\b/im.test(content);
    const hasOutline = /^\s*#+\s+(?:Gliederung|Inhaltsverzeichnis|Oberthemen|Themen)\b/im.test(content);
    return hasSummary && hasOutline;
}

/**
 * Parses a structured input note containing:
 *   # Zusammenfassung
 *   {Zusammenfassung}
 *   # Gliederung
 *   {Oberthemen}
 *
 * @param {string} content - Full text of the input note.
 * @param {object} app - Obsidian App instance.
 * @returns {object|null} { summary: string, oberthemenFiles: TFile[], outlineItems: object[] } or null.
 */
function parseStructuredInputNote(content, app) {
    if (!content) return null;
    const lines = content.replace(/\r\n?/g, "\n").split("\n");

    let summaryHeadingIdx = -1;
    let summaryHeadingLevel = 1;
    let outlineHeadingIdx = -1;
    let outlineHeadingLevel = 1;

    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        const mSummary = line.match(/^\s*(#{1,6})\s+(?:Zusammenfassung|Summary)\b/i);
        if (mSummary && summaryHeadingIdx === -1) {
            summaryHeadingIdx = i;
            summaryHeadingLevel = mSummary[1].length;
            continue;
        }

        const mOutline = line.match(/^\s*(#{1,6})\s+(?:Gliederung|Inhaltsverzeichnis|Oberthemen|Themen)\b/i);
        if (mOutline && outlineHeadingIdx === -1) {
            outlineHeadingIdx = i;
            outlineHeadingLevel = mOutline[1].length;
            continue;
        }
    }

    if (summaryHeadingIdx === -1 && outlineHeadingIdx === -1) {
        return null;
    }

    // Extract summary lines
    let summaryText = "";
    if (summaryHeadingIdx !== -1) {
        const summaryLines = [];
        inFence = false;
        for (let i = summaryHeadingIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*(```|~~~)/.test(line)) {
                inFence = !inFence;
                summaryLines.push(line);
                continue;
            }
            if (!inFence) {
                const mHead = line.match(/^\s*(#{1,6})\s+(.*)$/);
                if (mHead) {
                    const level = mHead[1].length;
                    const title = mHead[2].trim();
                    if (/^(?:Gliederung|Inhaltsverzeichnis|Oberthemen|Themen)\b/i.test(title)) {
                        break;
                    }
                    if (level <= summaryHeadingLevel) {
                        break;
                    }
                }
            }
            summaryLines.push(line);
        }
        summaryText = summaryLines.join("\n").trim();
    }

    // Extract outline lines & notes
    const rawOutlineItems = [];
    if (outlineHeadingIdx !== -1) {
        inFence = false;
        for (let i = outlineHeadingIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*(```|~~~)/.test(line)) {
                inFence = !inFence;
                continue;
            }
            if (!inFence) {
                const mHead = line.match(/^\s*(#{1,6})\s+(.*)$/);
                if (mHead) {
                    const level = mHead[1].length;
                    const title = mHead[2].trim();
                    if (/^(?:Zusammenfassung|Summary)\b/i.test(title)) {
                        break;
                    }
                    if (level <= outlineHeadingLevel) {
                        break;
                    }
                }
            }

            if (line.trim().length === 0) continue;

            const indentMatch = line.match(/^(\s*)/);
            const indentStr = indentMatch ? indentMatch[1] : "";
            const indentLevel = Math.floor(indentStr.replace(/\t/g, "  ").length / 2);

            const wikiMatches = [...line.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)];
            if (wikiMatches.length > 0) {
                for (const wm of wikiMatches) {
                    const noteName = wm[1].trim();
                    if (noteName) {
                        rawOutlineItems.push({ name: noteName, indentLevel });
                    }
                }
            } else {
                const itemMatch = line.match(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+(.+)$/);
                const candidateName = itemMatch ? itemMatch[1].trim() : line.trim();
                const cleanCandidate = cleanTitle(candidateName);
                if (cleanCandidate && !cleanCandidate.startsWith("#")) {
                    rawOutlineItems.push({ name: cleanCandidate, indentLevel });
                }
            }
        }
    }

    // Resolve note names to TFile objects in the vault
    const allFiles = app?.vault?.getMarkdownFiles ? app.vault.getMarkdownFiles() : [];
    const resolvedOberthemen = [];
    const resolvedItems = [];

    for (const item of rawOutlineItems) {
        let file = null;
        if (app?.metadataCache?.getFirstLinkpathDest) {
            file = app.metadataCache.getFirstLinkpathDest(item.name, "");
        }
        if (!file && allFiles.length > 0) {
            file = allFiles.find(f =>
                f.basename === item.name ||
                f.path === item.name ||
                f.name === item.name ||
                f.path.endsWith("/" + item.name) ||
                f.path.endsWith("/" + item.name + ".md")
            ) || null;
        }

        if (file) {
            if (!resolvedOberthemen.some(f => f.path === file.path)) {
                resolvedOberthemen.push(file);
            }
            resolvedItems.push({ file, indentLevel: item.indentLevel });
        }
    }

    return {
        summary: summaryText,
        oberthemenFiles: resolvedOberthemen,
        outlineItems: resolvedItems
    };
}

/**
 * Builds an explicit parent-to-children map based on the indentation of outline items.
 *
 * @param {object[]} outlineItems - Array of { file: TFile, indentLevel: number }.
 * @returns {Map<string, TFile[]>} Map of parent file path -> child TFile[].
 */
function buildExplicitParentToChildrenMap(outlineItems) {
    const explicitMap = new Map();
    if (!outlineItems || outlineItems.length === 0) return explicitMap;

    const stack = [];

    for (const item of outlineItems) {
        while (stack.length > 0 && stack[stack.length - 1].indentLevel >= item.indentLevel) {
            stack.pop();
        }

        if (stack.length > 0) {
            const parent = stack[stack.length - 1].file;
            if (!explicitMap.has(parent.path)) {
                explicitMap.set(parent.path, []);
            }
            const children = explicitMap.get(parent.path);
            if (!children.some(f => f.path === item.file.path)) {
                children.push(item.file);
            }
        }

        stack.push(item);
    }

    return explicitMap;
}

/**
 * Extracts root (top-level) files from an outline item list based on minimum indentation.
 *
 * @param {object[]} outlineItems - Array of { file: TFile, indentLevel: number }.
 * @returns {TFile[]} Array of root TFile objects.
 */
function getRootFilesFromOutline(outlineItems) {
    if (!outlineItems || outlineItems.length === 0) return [];
    let minIndent = Infinity;
    for (const it of outlineItems) {
        if (it.indentLevel < minIndent) minIndent = it.indentLevel;
    }
    const roots = [];
    for (const it of outlineItems) {
        if (it.indentLevel === minIndent && !roots.some(f => f.path === it.file.path)) {
            roots.push(it.file);
        }
    }
    return roots;
}

/**
 * Builds the hierarchical topic tree from overarching notes and their children
 * based on metadata tags ('up', 'parent', 'mytags') and explicit outline items.
 *
 * @param {TFile[]} oberthemenFiles - Selected overarching note files.
 * @param {object} app - Obsidian App instance.
 * @param {object[]} [outlineItems=[]] - Optional explicit outline items from input note.
 * @returns {Promise<object[]>} Array of root tree nodes.
 */
async function buildTopicTree(oberthemenFiles, app, outlineItems = []) {
    const allFiles = app.vault.getMarkdownFiles();
    const metadataCache = app.metadataCache;

    // Pre-cache metadata & links for all vault files
    const fileDataMap = new Map();
    for (const file of allFiles) {
        const cache = metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter || null;
        let fileContent = "";
        try {
            fileContent = await app.vault.read(file);
        } catch (e) {
            fileContent = "";
        }
        const upLinks = extractUpLinks(frontmatter, fileContent);
        const downLinks = extractDownLinks(frontmatter, fileContent);
        const requiresLinks = extractRequiresLinks(frontmatter, fileContent);
        const requiredByLinks = extractRequiredByLinks(frontmatter, fileContent);

        fileDataMap.set(file.path, {
            file,
            cache,
            frontmatter,
            content: fileContent,
            upLinks,
            downLinks,
            requiresLinks,
            requiredByLinks,
            requiredNotes: [...requiresLinks]
        });
    }

    // Resolve inverse required_by links:
    // If file A has required_by: [[B]], then B requires A!
    for (const [aPath, aData] of fileDataMap.entries()) {
        if (aData.requiredByLinks && aData.requiredByLinks.length > 0) {
            for (const [bPath, bData] of fileDataMap.entries()) {
                if (aPath === bPath) continue;
                if (isChildOf(aData.requiredByLinks, bData.file)) {
                    const reqName = aData.file.basename;
                    if (!bData.requiredNotes.includes(reqName) && !bData.requiredNotes.includes(`[[${reqName}]]`)) {
                        bData.requiredNotes.push(reqName);
                    }
                }
            }
        }
    }

    // Build metadata-based parent-to-children index:
    // File B is a child of File A if:
    // 1. File B has File A in its upLinks (B points UP to A) OR
    // 2. File A has File B in its downLinks (A points DOWN to B)
    // (Fields like 'next' or 'prev' are strictly ignored!)
    const metadataParentToChildren = new Map();
    for (const [childPath, childData] of fileDataMap.entries()) {
        for (const [parentPath, parentData] of fileDataMap.entries()) {
            if (childPath === parentPath) continue;

            const childPointsUp = isChildOf(childData.upLinks, parentData.file);
            const parentPointsDown = isChildOf(parentData.downLinks, childData.file);

            if (childPointsUp || parentPointsDown) {
                if (!metadataParentToChildren.has(parentPath)) {
                    metadataParentToChildren.set(parentPath, []);
                }
                const children = metadataParentToChildren.get(parentPath);
                if (!children.some(f => f.path === childData.file.path)) {
                    children.push(childData.file);
                }
            }
        }
    }

    // Build explicit parent-to-children index from outline items (if hierarchical)
    const explicitParentToChildren = buildExplicitParentToChildrenMap(outlineItems);

    const visitedGlobal = new Set();

    /**
     * Recursive function to build tree node and its subtopics.
     */
    function buildNode(file, level, numbering, parentPathList = []) {
        if (parentPathList.includes(file.path)) {
            // Cycle detected
            return null;
        }
        visitedGlobal.add(file.path);

        const data = fileDataMap.get(file.path);
        const rawTitle = file.basename;
        const cleanName = cleanTitle(rawTitle);
        const anchorId = slugifyAnchor(`sec-${numbering}-${cleanName}`);

        // Merge children: explicit children first, then metadata children not already included
        const explicitChildFiles = explicitParentToChildren.get(file.path) || [];
        const metaChildFiles = metadataParentToChildren.get(file.path) || [];

        const childFiles = [...explicitChildFiles];
        for (const mf of metaChildFiles) {
            if (!childFiles.some(f => f.path === mf.path)) {
                childFiles.push(mf);
            }
        }

        // Sort children:
        // 1. If explicit children, preserve explicit order
        // 2. For remaining metadata children: if parent text links to them in order, respect appearance order
        // 3. Otherwise sort by creation date or basename
        const content = data?.content || "";
        childFiles.sort((a, b) => {
            const isExplicitA = explicitChildFiles.some(f => f.path === a.path);
            const isExplicitB = explicitChildFiles.some(f => f.path === b.path);
            if (isExplicitA && isExplicitB) {
                return explicitChildFiles.indexOf(a) - explicitChildFiles.indexOf(b);
            }
            if (isExplicitA) return -1;
            if (isExplicitB) return 1;

            const idxA = content.indexOf(`[[${a.basename}`);
            const idxB = content.indexOf(`[[${b.basename}`);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;

            const timeA = a.stat?.ctime || 0;
            const timeB = b.stat?.ctime || 0;
            if (timeA !== timeB) return timeA - timeB;

            return a.basename.localeCompare(b.basename, "de", { sensitivity: "base" });
        });

        const currentPathList = [...parentPathList, file.path];
        const children = [];
        let childIndex = 1;

        for (const childFile of childFiles) {
            if (currentPathList.includes(childFile.path)) continue;
            const childNumbering = `${numbering}.${childIndex}`;
            const childNode = buildNode(childFile, level + 1, childNumbering, currentPathList);
            if (childNode) {
                children.push(childNode);
                childIndex++;
            }
        }

        return {
            file,
            title: cleanName,
            rawTitle,
            level,
            numbering: numbering.includes(".") ? numbering : `${numbering}.`,
            anchorId,
            requiredNotes: data?.requiredNotes || [],
            content: data?.content || "",
            children
        };
    }

    const roots = [];
    const rootFiles = (outlineItems && outlineItems.length > 0)
        ? getRootFilesFromOutline(outlineItems)
        : oberthemenFiles;

    const filesToProcess = (rootFiles && rootFiles.length > 0) ? rootFiles : oberthemenFiles;

    let rootIndex = 1;
    for (const rootFile of filesToProcess) {
        const rootNode = buildNode(rootFile, 1, `${rootIndex}`, []);
        if (rootNode) {
            roots.push(rootNode);
            rootIndex++;
        }
    }

    return roots;
}

/**
 * Generates the clickable Table of Contents (Gliederung) markdown string.
 * Each entry has:
 * - Clickable anchor link matching the document's section headings
 * - Hierarchical indentation and numbering
 * - In parentheses: Required notes (e.g. '([[Lineare Algebra]], [[Mathe I]])')
 *
 * @param {object[]} tree - Hierarchical topic tree.
 * @returns {string} Formatted Markdown Gliederung.
 */
function generateClickableGliederung(tree) {
    const lines = [];

    function traverse(node, depth) {
        const indent = "  ".repeat(depth);
        const headingAnchor = `#${node.anchorId}`;
        const label = `${node.numbering} ${node.title}`;

        let reqString = "";
        if (node.requiredNotes && node.requiredNotes.length > 0) {
            const reqFormatted = node.requiredNotes
                .map(r => (r.startsWith("[[") ? r : `[[${r}]]`))
                .join(", ");
            reqString = ` (${reqFormatted})`;
        }

        // Clickable anchor link in outline
        lines.push(`${indent}- [${label}](${headingAnchor})${reqString}`);

        for (const child of node.children) {
            traverse(child, depth + 1);
        }
    }

    for (const root of tree) {
        traverse(root, 0);
    }

    return lines.join("\n");
}

/**
 * Compiles the full document content containing:
 * - Frontmatter
 * - Document Title
 * - Summary (Zusammenfassung)
 * - Clickable Gliederung
 * - Full Note bodies structured by the hierarchy
 *
 * @param {object} params - Compilation parameters.
 * @returns {string} Complete Markdown document string.
 */
function compileDocument({ summary, tree, options = {} }) {
    const summaryTitle = options.summaryTitle || "Zusammenfassung";
    const tocTitle = options.tocTitle || "Gliederung";
    const docTitle = options.docTitle || (tree.length > 0 ? tree.map(r => r.title).join(" & ") : "Themenübersicht");

    const parts = [];

    // Frontmatter
    parts.push("---");
    parts.push(`title: "${docTitle.replace(/"/g, '\\"')}"`);
    parts.push(`date: "${new Date().toISOString().slice(0, 10)}"`);
    parts.push("tags:\n  - export/pdf");
    parts.push("---\n");

    // Title
    parts.push(`# ${docTitle}\n`);

    // 1. Zusammenfassung (Summary)
    if (summary && summary.trim().length > 0) {
        parts.push(`## ${summaryTitle}\n`);
        parts.push(summary.trim() + "\n");
        parts.push("\n---\n");
    }

    // 2. Clickable Gliederung (Table of Contents)
    parts.push(`## ${tocTitle}\n`);
    const gliederung = generateClickableGliederung(tree);
    parts.push(gliederung + "\n");
    parts.push("\n---\n");

    // 3. Notes entsprechend der Gliederung (Content sections)
    function renderNodeContent(node) {
        const headingLevel = Math.min(6, Math.max(1, node.level));
        const headingPrefix = "#".repeat(headingLevel);

        // Section Anchor & Heading
        const sectionHeading = `<span id="${node.anchorId}"></span>\n${headingPrefix} ${node.numbering} ${node.title}`;
        parts.push(sectionHeading + "\n");

        // Optional badge for required notes under heading
        if (node.requiredNotes && node.requiredNotes.length > 0) {
            const reqFormatted = node.requiredNotes
                .map(r => (r.startsWith("[[") ? r : `[[${r}]]`))
                .join(", ");
            parts.push(`> [!note] Voraussetzungen: ${reqFormatted}\n`);
        }

        // Clean note body: strip frontmatter, strip # Unterthemen, prefix footnotes, relevel inner headings
        let body = deleteMetadataInString(node.content);
        body = stripUnterthemenSection(body);
        if (body.trim().length > 0) {
            body = prefixFootnotesInNote(body, node.anchorId);
            const releveled = relevelMarkdownHeadings(body.trim(), headingLevel);
            parts.push(releveled + "\n");
        }

        parts.push("\n");

        for (const child of node.children) {
            renderNodeContent(child);
        }
    }

    for (const root of tree) {
        renderNodeContent(root);
    }

    // Renumber footnotes across the entire document
    const fullText = parts.join("\n");
    return renumberFootnotesAcrossDocument(fullText);
}

/**
 * Main Templater script function: createPdfFromTopics
 *
 * @param {object} tp - Templater context object.
 * @param {object} [options={}] - Optional programmatic overrides.
 * @returns {Promise<string>}
 */
function createPdfFromTopics(tp, options = {}) {
    const promise = (async () => {
        const app = tp.app || window.app;
        const allNotes = app.vault.getMarkdownFiles().sort((a, b) =>
            a.basename.localeCompare(b.basename, "de", { sensitivity: "base" })
        );
        const activeFile = tp.config?.target_file ?? app.workspace.getActiveFile();

        let summaryText = "";
        let selectedOberthemen = [];
        let outlineItems = [];
        let inputNoteFile = null;

        // ----------------------------------------------------
        // Check for structured input note in options or active note
        // Format:
        //   # Zusammenfassung
        //   {Zusammenfassung}
        //   # Gliederung
        //   {Oberthemen}
        // ----------------------------------------------------
        if (options.inputNote || options.sourceFile) {
            const candidate = options.inputNote || options.sourceFile;
            inputNoteFile = typeof candidate === "string"
                ? app.vault.getAbstractFileByPath(candidate) || allNotes.find(f => f.basename === candidate)
                : candidate;
            if (inputNoteFile) {
                const content = await app.vault.read(inputNoteFile);
                const parsed = parseStructuredInputNote(content, app);
                if (parsed) {
                    summaryText = parsed.summary;
                    selectedOberthemen = parsed.oberthemenFiles;
                    outlineItems = parsed.outlineItems;
                }
            }
        }

        if (!inputNoteFile && activeFile) {
            try {
                const activeContent = await app.vault.read(activeFile);
                if (hasStructuredInputSections(activeContent)) {
                    let useActive = true;
                    if (!options.skipPrompt && tp.system) {
                        const confirmChoices = [
                            `✅ Aktive Notiz '${activeFile.basename}' als Eingabe verwenden [Standard]`,
                            "🔍 Andere Notizen manuell auswählen...",
                            "❌ Vorgang abbrechen"
                        ];
                        const confirmValues = ["USE_ACTIVE", "MANUAL", "CANCEL"];
                        const chosen = await tp.system.suggester(
                            confirmChoices,
                            confirmValues,
                            false,
                            `Eingabe-Struktur (# Zusammenfassung & # Gliederung) in '${activeFile.basename}' erkannt:`
                        );

                        if (chosen === "CANCEL" || chosen === undefined || chosen === null) {
                            new Notice("Abgebrochen: Vorgang abgebrochen.");
                            return "";
                        }
                        useActive = (chosen === "USE_ACTIVE");
                    }

                    if (useActive) {
                        const parsed = parseStructuredInputNote(activeContent, app);
                        if (parsed) {
                            summaryText = parsed.summary;
                            selectedOberthemen = parsed.oberthemenFiles;
                            outlineItems = parsed.outlineItems;
                            inputNoteFile = activeFile;
                        }
                    }
                }
            } catch (e) {
                // Ignore read error on active file
            }
        }

        // ----------------------------------------------------
        // 1. EINGABE: Zusammenfassung (Summary)
        // ----------------------------------------------------
        if (!summaryText && typeof options.summary === "string") {
            summaryText = options.summary;
        } else if (!summaryText && options.summary && typeof options.summary === "object") {
            summaryText = await app.vault.read(options.summary);
        }

        if (!summaryText && selectedOberthemen.length === 0 && !options.skipSummaryPrompt && tp.system) {
            const summaryChoices = [
                "📋 Notiz mit '# Zusammenfassung' & '# Gliederung' laden...",
                "📄 Zusammenfassung aus bestehender Notiz laden...",
                "✍️ Zusammenfassung manuell eingeben...",
                activeFile ? `📌 Aktive Notiz als Zusammenfassung: ${activeFile.basename}` : null,
                "⏭️ Ohne Zusammenfassung fortfahren",
                "❌ Vorgang abbrechen"
            ].filter(Boolean);

            const summaryValues = [
                "INPUT_NOTE",
                "NOTE",
                "INPUT",
                activeFile ? "ACTIVE" : null,
                "SKIP",
                "CANCEL"
            ].filter(Boolean);

            const chosenSummaryMode = await tp.system.suggester(
                summaryChoices,
                summaryValues,
                false,
                "Wie möchtest du die Eingaben bereitstellen?"
            );

            if (chosenSummaryMode === "CANCEL" || chosenSummaryMode === undefined || chosenSummaryMode === null) {
                new Notice("Abgebrochen: Vorgang abgebrochen.");
                return "";
            }

            if (chosenSummaryMode === "INPUT_NOTE") {
                const noteChoices = allNotes.map(n => n.basename);
                const chosenNote = await tp.system.suggester(
                    noteChoices,
                    allNotes,
                    false,
                    "Wähle die Notiz aus, die '# Zusammenfassung' und '# Gliederung' enthält:"
                );
                if (!chosenNote) {
                    new Notice("Abgebrochen: Keine Notiz gewählt.");
                    return "";
                }
                const content = await app.vault.read(chosenNote);
                const parsed = parseStructuredInputNote(content, app);
                if (parsed) {
                    summaryText = parsed.summary;
                    selectedOberthemen = parsed.oberthemenFiles;
                    outlineItems = parsed.outlineItems;
                    inputNoteFile = chosenNote;
                } else {
                    new Notice("⚠️ Keine Abschnitte '# Zusammenfassung' oder '# Gliederung' in dieser Notiz gefunden.");
                }
            } else if (chosenSummaryMode === "NOTE") {
                const noteChoices = allNotes.map(n => n.basename);
                const chosenNote = await tp.system.suggester(
                    noteChoices,
                    allNotes,
                    false,
                    "Wähle die Notiz aus, die als Zusammenfassung dienen soll:"
                );
                if (!chosenNote) {
                    new Notice("Abgebrochen: Keine Zusammenfassungs-Notiz gewählt.");
                    return "";
                }
                const rawContent = await app.vault.read(chosenNote);
                summaryText = deleteMetadataInString(rawContent);
            } else if (chosenSummaryMode === "INPUT") {
                const inputPrompt = await tp.system.prompt("Gib hier die Zusammenfassung ein (oder füge sie ein):");
                if (inputPrompt === undefined || inputPrompt === null) {
                    new Notice("Abgebrochen: Keine Eingabe erfolgt.");
                    return "";
                }
                summaryText = inputPrompt;
            } else if (chosenSummaryMode === "ACTIVE" && activeFile) {
                const rawContent = await app.vault.read(activeFile);
                summaryText = deleteMetadataInString(rawContent);
            }
        }

        // ----------------------------------------------------
        // 2. EINGABE: Oberthemen Notes
        // ----------------------------------------------------
        if (selectedOberthemen.length === 0 && Array.isArray(options.oberthemenNotes) && options.oberthemenNotes.length > 0) {
            for (const item of options.oberthemenNotes) {
                if (typeof item === "string") {
                    const found = app.vault.getAbstractFileByPath(item) ||
                                  allNotes.find(f => f.basename === item);
                    if (found) selectedOberthemen.push(found);
                } else if (item && item.path) {
                    selectedOberthemen.push(item);
                }
            }
        }

        if (selectedOberthemen.length === 0 && tp.system) {
            let selecting = true;

            while (selecting) {
                const isFirst = selectedOberthemen.length === 0;
                const choices = [];
                const values = [];

                if (!isFirst) {
                    choices.push(`✅ Auswahl abschließen (${selectedOberthemen.length} Oberthema/Oberthemen gewählt)`);
                    values.push("__DONE__");
                }

                if (activeFile && !selectedOberthemen.some(f => f.path === activeFile.path)) {
                    choices.push(`📌 Aktive Notiz hinzufügen: ${activeFile.basename}`);
                    values.push(activeFile);
                }

                choices.push("❌ Vorgang abbrechen");
                values.push("__CANCEL__");

                // Add vault notes
                for (const note of allNotes) {
                    if (!selectedOberthemen.some(sel => sel.path === note.path)) {
                        choices.push(note.basename);
                        values.push(note);
                    }
                }

                const promptMsg = isFirst
                    ? "Wähle das 1. Oberthema (Oberthemen-Notiz):"
                    : `Oberthema hinzugefügt. Weiteres Oberthema wählen oder abschließen:`;

                const chosen = await tp.system.suggester(choices, values, false, promptMsg);

                if (chosen === "__CANCEL__" || chosen === undefined || chosen === null) {
                    if (isFirst) {
                        new Notice("Abgebrochen: Keine Oberthemen-Notiz ausgewählt.");
                        return "";
                    }
                    // If user pressed ESC after choosing at least one, conclude with current selection
                    break;
                }

                if (chosen === "__DONE__") {
                    break;
                }

                selectedOberthemen.push(chosen);
            }
        }

        if (selectedOberthemen.length === 0) {
            new Notice("❌ Keine Oberthemen ausgewählt. Vorgang beendet.");
            return "";
        }

        new Notice(`⏳ Erstelle hierarchischen Baum für ${selectedOberthemen.length} Oberthema/Oberthemen...`);

        // ----------------------------------------------------
        // 3. HIERARCHIE & BAUM AUFBAUEN
        // ----------------------------------------------------
        const topicTree = await buildTopicTree(selectedOberthemen, app, outlineItems);

        // ----------------------------------------------------
        // 4. AUSGABE-DOKUMENT ZUSAMMENSTELLEN
        // ----------------------------------------------------
        const docTitle = options.docTitle || (inputNoteFile ? cleanTitle(inputNoteFile.basename) : undefined);
        const compiledDoc = compileDocument({
            summary: summaryText,
            tree: topicTree,
            options: { ...options, docTitle }
        });

        // Determine destination folder and filename
        const referenceFile = inputNoteFile || selectedOberthemen[0];
        let targetFolder = options.targetFolder;
        if (!targetFolder) {
            targetFolder = referenceFile.parent?.path || "";
        }
        if (targetFolder === "/") targetFolder = "";

        const timestamp = (typeof window !== "undefined" && window.moment)
            ? window.moment().format("YYYYMMDDHHmm")
            : (tp.date ? tp.date.now("YYYYMMDDHHmm") : "");

        const baseTitle = cleanTitle(referenceFile.basename);
        let outFileName = options.fileName || `Zusammenfassung - ${baseTitle}`;
        if (timestamp && !options.fileName) {
            outFileName += ` (${timestamp})`;
        }
        const outFilePath = targetFolder ? `${targetFolder}/${outFileName}.md` : `${outFileName}.md`;

        let createdFile = null;
        try {
            const existing = app.vault.getAbstractFileByPath(outFilePath);
            if (existing) {
                await app.vault.modify(existing, compiledDoc);
                createdFile = existing;
            } else {
                createdFile = await app.vault.create(outFilePath, compiledDoc);
            }
        } catch (err) {
            console.error("Fehler beim Erstellen der PDF-Zusammenfassung:", err);
            new Notice(`❌ Fehler beim Erstellen der Datei: ${err.message}`);
            return "";
        }

        // ----------------------------------------------------
        // 5. DATEI ÖFFNEN & PDF EXPORTIEREN
        // ----------------------------------------------------
        if (createdFile) {
            const leaf = app.workspace.getLeaf(false);
            await leaf.openFile(createdFile);

            const shouldOpenPdf = options.openPdfDialog !== false;
            if (shouldOpenPdf) {
                // Short delay to allow the leaf to finish rendering markdown preview
                setTimeout(() => {
                    const exported = app.commands.executeCommandById("app:export-pdf") ||
                                     app.commands.executeCommandById("workspace:export-pdf");
                    if (exported) {
                        new Notice("📄 PDF-Export geöffnet! Bitte Layout wählen und als PDF speichern.");
                    } else {
                        new Notice("✅ Dokument erstellt! Wähle 'Als PDF exportieren' im Notizmenü.");
                    }
                }, 350);
            } else {
                new Notice(`✅ Export-Dokument '${outFileName}.md' erfolgreich erstellt!`);
            }
        }

        const result = {
            createdFile,
            filePath: outFilePath,
            tree: topicTree,
            compiledContent: compiledDoc,
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

    // In case the function is called without await in a Templater interpolated tag: <% tp.user.createPdfFromTopics(tp) %>
    promise.toString = () => "";
    promise.valueOf = () => "";
    if (typeof Symbol !== "undefined" && Symbol.toPrimitive) {
        promise[Symbol.toPrimitive] = () => "";
    }

    return promise;
}

module.exports = createPdfFromTopics;

module.exports.cleanTitle = cleanTitle;
module.exports.deleteMetadataInString = deleteMetadataInString;
module.exports.stripUnterthemenSection = stripUnterthemenSection;
module.exports.slugifyAnchor = slugifyAnchor;
module.exports.extractRequiredNotes = extractRequiredNotes;
module.exports.extractParentLinks = extractParentLinks;
module.exports.isChildOf = isChildOf;
module.exports.relevelMarkdownHeadings = relevelMarkdownHeadings;
module.exports.prefixFootnotesInNote = prefixFootnotesInNote;
module.exports.renumberFootnotesAcrossDocument = renumberFootnotesAcrossDocument;
module.exports.hasStructuredInputSections = hasStructuredInputSections;
module.exports.parseStructuredInputNote = parseStructuredInputNote;
module.exports.buildExplicitParentToChildrenMap = buildExplicitParentToChildrenMap;
module.exports.getRootFilesFromOutline = getRootFilesFromOutline;
module.exports.buildTopicTree = buildTopicTree;
module.exports.generateClickableGliederung = generateClickableGliederung;
module.exports.compileDocument = compileDocument;
module.exports.extractUpLinks = extractUpLinks;
module.exports.extractDownLinks = extractDownLinks;
module.exports.extractRequiresLinks = extractRequiresLinks;
module.exports.extractRequiredByLinks = extractRequiredByLinks;
