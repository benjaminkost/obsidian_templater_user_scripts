/**
 * Templater User Script: replaceMytagsWithTags
 *
 * Scans notes for organizational note links in the 'mytags' frontmatter property
 * (e.g. modules [[SS 26 Elektrizität und Magnetismus]] or degrees [[Bachelor Elektrotechnik und Informationstechnologie|...]])
 * and converts them into tags placed in the 'tags' property.
 *
 * Tag naming convention:
 * - Strips leading number prefix "{number} - " (if present).
 * - Replaces whitespace with hyphens.
 * - E.g. "202410261200 - SS 26 Elektrizität und Magnetismus" -> "SS-26-Elektrizität-und-Magnetismus"
 *
 * Clean-up behavior:
 * - Adds the generated tag to 'tags' (avoiding duplicates).
 * - Removes the matching entry from 'mytags'.
 * - If 'mytags' becomes empty, the 'mytags' property is deleted from the note's frontmatter.
 * - Displays a Notice with all generated tags.
 *
 * Usage in a template:
 *   <%* await tp.user.replaceMytagsWithTags(tp) -%>
 *
 * Programmatic usage:
 *   <%* await tp.user.replaceMytagsWithTags(tp, {
 *       targetFolder: "/", // "/" for entire vault, or folder path like "1 - Rough Notes"
 *       selectedNotes: ["SS 26 Elektrizität und Magnetismus"] // note names or TFile objects
 *   }) -%>
 */

/**
 * Converts a note filename/basename into a tag string.
 * Strips leading "{number} - " or "{number}-" prefix and replaces spaces with hyphens.
 *
 * @param {string} basename - The file basename (without .md extension).
 * @returns {string} The formatted tag.
 */
function filenameToTag(basename) {
    if (!basename || typeof basename !== "string") return "";
    const match = basename.match(/^\d+\s*-\s*(.+)$/);
    const namePart = match ? match[1] : basename;
    return namePart.trim().replace(/^#+/, "").replace(/\s+/g, "-");
}

/**
 * Helper to normalize frontmatter lists (handles arrays, single strings, and comma-separated strings).
 *
 * @param {any} raw - Raw property value from frontmatter.
 * @returns {any[]} Normalized array of entries.
 */
function parseEntryList(raw) {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
        return raw.includes(",")
            ? raw.split(",").map(s => s.trim()).filter(Boolean)
            : [raw.trim()];
    }
    return [raw];
}

/**
 * Extracts the clean note target from a raw frontmatter link entry.
 * Strips wikilink brackets [[ ]], aliases (| ...), and anchors (# ...).
 *
 * @param {any} rawEntry - Raw entry from frontmatter (string, link, or object).
 * @returns {string} The cleaned target name.
 */
function extractCleanLinkTarget(rawEntry) {
    if (rawEntry === null || rawEntry === undefined) return "";
    let str = String(rawEntry).trim();
    // Strip wikilink brackets
    str = str.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
    // Strip alias
    if (str.includes("|")) {
        str = str.split("|")[0].trim();
    }
    // Strip heading or block anchor
    if (str.includes("#")) {
        str = str.split("#")[0].trim();
    }
    return str;
}

/**
 * Resolves a cleaned link target string to a generated tag using the lookup map.
 *
 * @param {string} cleanTarget - Cleaned note target string.
 * @param {Record<string, string>} nameToTag - Lookup map of note names/paths to tag strings.
 * @returns {string|null} The resolved tag or null if not matching.
 */
function findTagForTarget(cleanTarget, nameToTag) {
    if (!cleanTarget || !nameToTag) return null;
    if (Object.prototype.hasOwnProperty.call(nameToTag, cleanTarget)) {
        return nameToTag[cleanTarget];
    }
    const withoutMd = cleanTarget.replace(/\.md$/i, "");
    if (Object.prototype.hasOwnProperty.call(nameToTag, withoutMd)) {
        return nameToTag[withoutMd];
    }
    const justBasename = cleanTarget.split("/").pop().replace(/\.md$/i, "");
    if (Object.prototype.hasOwnProperty.call(nameToTag, justBasename)) {
        return nameToTag[justBasename];
    }
    return null;
}

/**
 * Safely shows an Obsidian Notice or falls back to console logging.
 *
 * @param {string} message - Message to display.
 * @param {number} [duration=7000] - Duration in milliseconds.
 */
function showNotice(message, duration = 7000) {
    if (typeof Notice !== "undefined") {
        new Notice(message, duration);
    } else {
        console.log(`[Notice] ${message}`);
    }
}

/**
 * Main execution function for the Templater user script.
 *
 * @param {object} tp - Templater interface object.
 * @param {object} [options={}] - Optional configuration parameters.
 * @param {string} [options.targetFolder] - Folder to process ("/" for all notes).
 * @param {Array<string|object>} [options.selectedNotes] - Preselected notes to replace.
 * @param {object} [options.app] - Custom Obsidian app instance (for testing).
 * @returns {Promise<{generatedTags: string[], modifiedFilesCount: number, processedFilesCount: number}>}
 */
async function replaceMytagsWithTags(tp, options = {}) {
    const obsidianApp = (typeof app !== "undefined" && app) ? app : (tp?.app || options?.app);
    if (!obsidianApp || !obsidianApp.vault) {
        showNotice("❌ Fehler: Obsidian App/Vault-Instanz nicht verfügbar.");
        return { generatedTags: [], modifiedFilesCount: 0, processedFilesCount: 0 };
    }

    const { fileManager, metadataCache, vault } = obsidianApp;
    const allFiles = vault.getMarkdownFiles();

    if (!allFiles || allFiles.length === 0) {
        showNotice("❌ Keine Markdown-Dateien im Vault gefunden.");
        return { generatedTags: [], modifiedFilesCount: 0, processedFilesCount: 0 };
    }

    // ========================================================
    // 0. Select target folder (Suggester or options)
    // ========================================================
    let targetFolder = options.targetFolder;
    if (targetFolder === undefined || targetFolder === null) {
        const folderSet = new Set();
        folderSet.add("/");

        allFiles.forEach(f => {
            const p = f.parent ? f.parent.path : (f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : "/");
            folderSet.add(p === "/" || !p ? "/" : p);
        });

        const folderOptions = Array.from(folderSet).sort();

        targetFolder = await tp.system.suggester(
            folderOptions,
            folderOptions,
            false,
            "Wähle den Zielordner ('/' tippen für den gesamten Vault)"
        );

        if (!targetFolder) {
            showNotice("Kein Ordner ausgewählt. Skript abgebrochen.");
            return { generatedTags: [], modifiedFilesCount: 0, processedFilesCount: 0 };
        }
    }

    let filesToProcess = allFiles;
    if (targetFolder !== "/") {
        filesToProcess = allFiles.filter(f => {
            const parentPath = f.parent ? f.parent.path : "";
            return f.path.startsWith(targetFolder + "/") || parentPath === targetFolder;
        });
    }

    // ==========================================================
    // 1. Note Selection (Suggester or options)
    // ==========================================================
    const selectedFiles = [];

    if (Array.isArray(options.selectedNotes) && options.selectedNotes.length > 0) {
        for (const noteRef of options.selectedNotes) {
            if (typeof noteRef === "object" && noteRef.basename) {
                selectedFiles.push(noteRef);
            } else if (typeof noteRef === "string") {
                const cleanRef = extractCleanLinkTarget(noteRef);
                const found = allFiles.find(f => f.basename === cleanRef || f.path === cleanRef || f.name === cleanRef);
                if (found) {
                    selectedFiles.push(found);
                } else {
                    selectedFiles.push({ basename: cleanRef, path: cleanRef, name: cleanRef });
                }
            }
        }
    } else {
        const doneSentinel = "✅ Fertig (Auswahl beenden)";

        while (true) {
            const remainingFiles = allFiles.filter(f => !selectedFiles.some(s => s.path === f.path));
            const displayNames = remainingFiles.map(f => f.basename);

            const suggesterOptions = [doneSentinel, ...displayNames];
            const suggesterValues = [null, ...remainingFiles];

            const choice = await tp.system.suggester(
                suggesterOptions,
                suggesterValues,
                false,
                `Notiz auswählen (${selectedFiles.length} bereits gewählt) – oder "Fertig" wählen`
            );

            if (choice === null || choice === undefined) {
                break;
            }

            selectedFiles.push(choice);
        }
    }

    if (selectedFiles.length === 0) {
        showNotice("Keine Notizen ausgewählt. Abgebrochen.");
        return { generatedTags: [], modifiedFilesCount: 0, processedFilesCount: 0 };
    }

    // ==========================================================
    // 2. Build Tag Mapping from Selected Notes
    //    Format: "{number} - Name" -> "Name" (spaces to hyphens)
    // ==========================================================
    const nameToTag = {};
    for (const file of selectedFiles) {
        const basename = file.basename;
        const tag = filenameToTag(basename);

        nameToTag[basename] = tag;
        if (file.path) nameToTag[file.path] = tag;
        if (file.path) nameToTag[file.path.replace(/\.md$/i, "")] = tag;
        if (file.name) nameToTag[file.name] = tag;

        // Strip number prefix if present for fallback matching
        const match = basename.match(/^\d+\s*-\s*(.+)$/);
        if (match) {
            nameToTag[match[1].trim()] = tag;
        }
    }

    // ==========================================================
    // 3. Scan files and migrate mytags -> tags
    // ==========================================================
    const generatedTags = new Set();
    let processedFilesCount = 0;
    let modifiedFilesCount = 0;

    for (const file of filesToProcess) {
        const cache = metadataCache ? metadataCache.getFileCache(file) : null;
        const mytagsCache = cache?.frontmatter?.mytags;

        if (mytagsCache === undefined || mytagsCache === null) {
            continue;
        }

        // Quick pre-check using metadata cache before attempting to write
        const rawEntries = parseEntryList(mytagsCache);
        let hasMatch = false;
        for (const entry of rawEntries) {
            const clean = extractCleanLinkTarget(entry);
            if (findTagForTarget(clean, nameToTag)) {
                hasMatch = true;
                break;
            }
        }

        if (!hasMatch) {
            continue;
        }

        let fileWasChanged = false;

        try {
            await fileManager.processFrontMatter(file, (frontmatter) => {
                let mytags = frontmatter["mytags"];
                if (mytags === undefined || mytags === null) return;

                const mytagEntries = parseEntryList(mytags);
                const tagEntries = parseEntryList(frontmatter["tags"]);

                const tags = [...tagEntries];
                const remainingMytags = [];
                let changed = false;

                for (const entry of mytagEntries) {
                    const cleanEntry = extractCleanLinkTarget(entry);
                    const newTag = findTagForTarget(cleanEntry, nameToTag);

                    if (newTag) {
                        const cleanTag = newTag.replace(/^#+/, "").trim();
                        const exists = tags.some(t => String(t).replace(/^#+/, "").trim() === cleanTag);
                        if (!exists) {
                            tags.push(cleanTag);
                        }
                        generatedTags.add(cleanTag);
                        changed = true;
                    } else {
                        remainingMytags.push(entry);
                    }
                }

                if (changed) {
                    frontmatter["tags"] = tags;

                    if (remainingMytags.length > 0) {
                        frontmatter["mytags"] = remainingMytags;
                    } else {
                        delete frontmatter["mytags"];
                    }
                    fileWasChanged = true;
                }
            });
        } catch (err) {
            console.error(`Fehler beim Aktualisieren von Frontmatter in "${file.path}":`, err);
        }

        if (fileWasChanged) {
            modifiedFilesCount++;
        }

        processedFilesCount++;

        // Pause to prevent CodeMirror RangeError / event backlog in Obsidian
        if (processedFilesCount % 5 === 0) {
            await new Promise(r => setTimeout(r, 10));
        }
    }

    // ==========================================================
    // 4. Output Results
    // ==========================================================
    if (generatedTags.size > 0) {
        const tagList = Array.from(generatedTags).map(t => `#${t}`).join(", ");
        showNotice(`✅ Generierte Tags (${modifiedFilesCount} Notiz(en) angepasst):\n${tagList}`, 10000);
    } else {
        showNotice("Keine passenden Referenzen in 'mytags' gefunden.");
    }

    return {
        generatedTags: Array.from(generatedTags),
        modifiedFilesCount,
        processedFilesCount
    };
}

module.exports = replaceMytagsWithTags;
module.exports.filenameToTag = filenameToTag;
module.exports.parseEntryList = parseEntryList;
module.exports.extractCleanLinkTarget = extractCleanLinkTarget;
module.exports.findTagForTarget = findTagForTarget;
