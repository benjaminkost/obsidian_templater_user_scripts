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
 * Extracts required notes from note metadata (frontmatter, inline Dataview fields, or bold tags).
 *
 * @param {object|null} frontmatter - Parsed frontmatter properties.
 * @param {string} [content=""] - Note content to search for inline fields.
 * @returns {string[]} Array of required note names/links.
 */
function extractRequiredNotes(frontmatter, content = "") {
    const required = [];
    const keys = [
        "required",
        "requires",
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
    ];

    function addRaw(val) {
        if (!val) return;
        if (Array.isArray(val)) {
            val.forEach(addRaw);
            return;
        }
        if (typeof val === "object") {
            const name = val.basename || val.name || val.path || "";
            if (name) addRaw(name);
            return;
        }
        const str = String(val).trim();
        if (!str || str === "[object Object]") return;

        // Check for wikilinks [[...]]
        const wikiMatches = [...str.matchAll(/\[\[([^\]]+)\]\]/g)];
        if (wikiMatches.length > 0) {
            for (const m of wikiMatches) {
                const inner = m[1].trim();
                if (inner && !required.includes(inner)) {
                    required.push(inner);
                }
            }
        } else {
            // Split by comma
            const parts = str.split(",").map(p => p.trim()).filter(Boolean);
            for (const p of parts) {
                const clean = p.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
                if (clean && !required.includes(clean)) {
                    required.push(clean);
                }
            }
        }
    }

    if (frontmatter && typeof frontmatter === "object") {
        for (const k of keys) {
            if (frontmatter[k] !== undefined && frontmatter[k] !== null) {
                addRaw(frontmatter[k]);
            }
        }
    }

    if (content) {
        // Dataview inline fields: [required:: [[A]], [[B]]] or required:: [[A]]
        const lines = content.replace(/\r\n?/g, "\n").split("\n");
        for (const line of lines) {
            // Bracketed field: [required:: ...]
            const bracketMatch = line.match(/\[(?:required|requires|requirements|prerequisites|voraussetzungen)::\s*(.+?)\](?=[^\]]*$)/i);
            if (bracketMatch) {
                addRaw(bracketMatch[1]);
            } else {
                // Line-level field: required:: ...
                const lineMatch = line.match(/^\s*(?:required|requires|requirements|prerequisites|voraussetzungen)::\s*(.+)$/i);
                if (lineMatch) {
                    addRaw(lineMatch[1]);
                }
            }

            // Bold inline text: **Voraussetzungen:** ... or **Required:** ...
            const boldMatch = line.match(/\*\*(?:Voraussetzungen|Prerequisites|Required|Benötigt):\*\*\s*(.+)$/i);
            if (boldMatch) {
                addRaw(boldMatch[1]);
            }
        }
    }

    return required;
}

/**
 * Extracts parent links from note metadata ('up', 'parent', 'mytags').
 *
 * @param {object|null} frontmatter - Parsed frontmatter properties.
 * @param {object|null} cache - Obsidian CachedMetadata.
 * @param {string} [content=""] - Note content.
 * @returns {string[]} Array of target note basenames or paths.
 */
function extractParentLinks(frontmatter, cache, content = "") {
    const parents = [];
    const keys = ["up", "parent", "mytags"];

    function addRaw(val) {
        if (!val) return;
        if (Array.isArray(val)) {
            val.forEach(addRaw);
            return;
        }
        if (typeof val === "object") {
            const name = val.basename || val.name || val.path || "";
            if (name) addRaw(name);
            return;
        }
        const str = String(val).trim();
        if (!str || str === "[object Object]") return;

        // Extract wikilinks [[Target|Alias]]
        const wikiMatches = [...str.matchAll(/\[\[([^\]]+)\]\]/g)];
        if (wikiMatches.length > 0) {
            for (const m of wikiMatches) {
                let link = m[1].trim();
                if (link.includes("|")) link = link.split("|")[0].trim();
                if (link.includes("#")) link = link.split("#")[0].trim();
                if (link && !parents.includes(link)) {
                    parents.push(link);
                }
            }
        } else {
            let clean = str.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
            if (clean && !parents.includes(clean)) {
                parents.push(clean);
            }
        }
    }

    if (frontmatter && typeof frontmatter === "object") {
        for (const k of keys) {
            if (frontmatter[k] !== undefined && frontmatter[k] !== null) {
                addRaw(frontmatter[k]);
            }
        }
    }

    if (cache?.frontmatterLinks) {
        for (const linkObj of cache.frontmatterLinks) {
            let l = linkObj.link;
            if (l.includes("|")) l = l.split("|")[0].trim();
            if (l.includes("#")) l = l.split("#")[0].trim();
            if (l && !parents.includes(l)) {
                parents.push(l);
            }
        }
    }

    if (content) {
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
            const fmText = fmMatch[1];
            for (const k of keys) {
                const reg = new RegExp(`^${k}:[ \\t]*(.*)$`, "m");
                const m = fmText.match(reg);
                if (m && m[1]) addRaw(m[1]);
            }
        }
    }

    return parents;
}

/**
 * Checks whether note B has note A as a parent link.
 *
 * @param {string[]} parentLinks - Parent links extracted from note B.
 * @param {TFile} targetFile - Parent candidate file A.
 * @returns {boolean} True if note B points to note A.
 */
function isChildOf(parentLinks, targetFile) {
    if (!parentLinks || parentLinks.length === 0) return false;
    const base = targetFile.basename;
    const path = targetFile.path;
    const name = targetFile.name;

    for (const link of parentLinks) {
        if (
            link === base ||
            link === path ||
            link === name ||
            link.endsWith("/" + base) ||
            link.endsWith("/" + name)
        ) {
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
 * Builds the hierarchical topic tree from overarching notes and their children
 * based on metadata tags ('up', 'parent', 'mytags').
 *
 * @param {TFile[]} oberthemenFiles - Selected overarching note files.
 * @param {object} app - Obsidian App instance.
 * @returns {Promise<object[]>} Array of root tree nodes.
 */
async function buildTopicTree(oberthemenFiles, app) {
    const allFiles = app.vault.getMarkdownFiles();
    const metadataCache = app.metadataCache;

    // Pre-cache metadata & parent links for all vault files
    const fileDataMap = new Map();
    for (const file of allFiles) {
        const cache = metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter || null;
        let content = "";
        try {
            content = await app.vault.read(file);
        } catch (e) {
            content = "";
        }
        const parentLinks = extractParentLinks(frontmatter, cache, content);
        const requiredNotes = extractRequiredNotes(frontmatter, content);

        fileDataMap.set(file.path, {
            file,
            cache,
            frontmatter,
            content,
            parentLinks,
            requiredNotes
        });
    }

    // Build parent-to-children index
    const parentToChildren = new Map();
    for (const file of allFiles) {
        const data = fileDataMap.get(file.path);
        for (const potentialParent of allFiles) {
            if (potentialParent.path === file.path) continue;
            if (isChildOf(data.parentLinks, potentialParent)) {
                if (!parentToChildren.has(potentialParent.path)) {
                    parentToChildren.set(potentialParent.path, []);
                }
                parentToChildren.get(potentialParent.path).push(file);
            }
        }
    }

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

        const childFiles = parentToChildren.get(file.path) || [];

        // Sort children:
        // 1. If parent text links to child in order, respect appearance order
        // 2. Otherwise sort by creation date (file.stat.ctime) or basename
        const content = data?.content || "";
        childFiles.sort((a, b) => {
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
    let rootIndex = 1;
    for (const rootFile of oberthemenFiles) {
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
module.exports = function (tp, options = {})  {
    const promise = (async () => {
        const app = tp.app || window.app;
        const allNotes = app.vault.getMarkdownFiles().sort((a, b) =>
            a.basename.localeCompare(b.basename, "de", { sensitivity: "base" })
        );
        const activeFile = tp.config?.target_file ?? app.workspace.getActiveFile();

        // ----------------------------------------------------
        // 1. EINGABE: Zusammenfassung (Summary)
        // ----------------------------------------------------
        let summaryText = "";
        if (typeof options.summary === "string") {
            summaryText = options.summary;
        } else if (options.summary && typeof options.summary === "object") {
            summaryText = await app.vault.read(options.summary);
        }

        if (!summaryText && !options.skipSummaryPrompt && tp.system) {
            const summaryChoices = [
                "📄 Aus bestehender Notiz laden...",
                "✍️ Text manuell eingeben...",
                activeFile ? `📌 Aktive Notiz verwenden: ${activeFile.basename}` : null,
                "⏭️ Ohne Zusammenfassung fortfahren",
                "❌ Vorgang abbrechen"
            ].filter(Boolean);

            const summaryValues = [
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
                "Wie möchtest du die Zusammenfassung bereitstellen?"
            );

            if (chosenSummaryMode === "CANCEL" || chosenSummaryMode === undefined || chosenSummaryMode === null) {
                new Notice("Abgebrochen: Vorgang abgebrochen.");
                return "";
            }

            if (chosenSummaryMode === "NOTE") {
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
        let selectedOberthemen = [];
        if (Array.isArray(options.oberthemenNotes) && options.oberthemenNotes.length > 0) {
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
        const topicTree = await buildTopicTree(selectedOberthemen, app);

        // ----------------------------------------------------
        // 4. AUSGABE-DOKUMENT ZUSAMMENSTELLEN
        // ----------------------------------------------------
        const compiledDoc = compileDocument({
            summary: summaryText,
            tree: topicTree,
            options
        });

        // Determine destination folder and filename
        const firstOberthema = selectedOberthemen[0];
        let targetFolder = options.targetFolder;
        if (!targetFolder) {
            targetFolder = firstOberthema.parent?.path || "";
        }
        if (targetFolder === "/") targetFolder = "";

        const timestamp = (typeof window !== "undefined" && window.moment)
            ? window.moment().format("YYYYMMDDHHmm")
            : (tp.date ? tp.date.now("YYYYMMDDHHmm") : "");

        const baseTitle = cleanTitle(firstOberthema.basename);
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
