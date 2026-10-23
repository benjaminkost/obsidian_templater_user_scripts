/**
 * Templater User Script: moveNotesContainingMetadata
 *
 * Prompts the user to choose between filtering by Note reference or by Tag.
 *
 * 1) Note filter mode:
 *    - Prompts the user to select a target note via a suggester.
 *    - Scans the vault (or a chosen source folder) for notes referencing the target note in their frontmatter/metadata.
 *    - Moves matching notes into a folder named after the target note at vault root level.
 *
 * 2) Tag filter mode:
 *    - Prompts the user to select a tag found in frontmatter (or enter one manually).
 *    - Scans the vault (or a chosen source folder) for notes containing this tag in their YAML frontmatter (tags/tag).
 *    - Includes nested sub-tags (e.g. searching for 'uni' matches 'uni' and 'uni/mathe').
 *    - Moves matching notes into a folder named after the tag, preserving hierarchy (e.g. 'uni/mathe').
 *
 * Usage:
 * 1) Interactively in a template or hotkey:
 *    <%* await tp.user.moveNotesContainingMetadata(tp) -%>
 *
 * 2) Calling with options:
 *    <%* await tp.user.moveNotesContainingMetadata(tp, {
 *        filterType: "tag", // "note" | "tag" (optional, prompts user if omitted)
 *        targetTag: "aufgaben", // optional for tag mode
 *        targetNote: "MyParentNote", // optional for note mode
 *        sourceFolder: "1 - Rough Notes", // optional, restricts search to this folder (null = entire vault)
 *        targetFolder: "CustomFolder" // optional, overrides default folder at root
 *    }) -%>
 */

/**
 * Recursively checks if an object or array contains a target substring in any string value.
 *
 * @param {any} obj - Object, array, or primitive to inspect.
 * @param {string} targetText - Text to look for.
 * @returns {boolean} True if found.
 */
function objectContainsText(obj, targetText) {
    if (!obj || !targetText) return false;
    if (typeof obj === "string") {
        return obj.includes(targetText);
    }
    if (Array.isArray(obj)) {
        return obj.some(item => objectContainsText(item, targetText));
    }
    if (typeof obj === "object") {
        return Object.values(obj).some(val => objectContainsText(val, targetText));
    }
    return false;
}

/**
 * Checks whether a given note contains the target note anywhere in its metadata/frontmatter.
 *
 * @param {TFile} file - Note file to check.
 * @param {TFile} targetFile - Target note being referenced.
 * @param {string} fileContent - Full text content of the note file.
 * @param {CachedMetadata|null} fileCache - Cached metadata from Obsidian.
 * @returns {boolean} True if the file contains the target note in metadata.
 */
function containsNoteInMetadata(file, targetFile, fileContent, fileCache) {
    // Never move the target note itself
    if (file.path === targetFile.path) {
        return false;
    }

    const targetBasename = targetFile.basename;
    const targetPath = targetFile.path;

    // 1. Check frontmatter links indexed in metadata cache
    if (fileCache?.frontmatterLinks) {
        for (const linkObj of fileCache.frontmatterLinks) {
            const link = linkObj.link;
            if (
                link === targetBasename ||
                link === targetPath ||
                link === targetFile.name ||
                link.endsWith("/" + targetBasename)
            ) {
                return true;
            }
        }
    }

    // 2. Check parsed frontmatter properties in metadata cache
    if (fileCache?.frontmatter) {
        if (objectContainsText(fileCache.frontmatter, targetBasename)) {
            return true;
        }
    }

    // 3. Fallback: inspect raw frontmatter text from the file content
    if (fileContent) {
        const fmMatch = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
            const fmText = fmMatch[1];
            if (fmText.includes(targetBasename)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Normalizes a tag string by stripping leading '#' and characters like brackets/quotes.
 *
 * @param {string} tag - Tag string.
 * @returns {string} Normalized tag without '#'.
 */
function normalizeTag(tag) {
    if (!tag || typeof tag !== "string") return "";
    return tag.replace(/^#+/, "").replace(/[\[\]"']/g, "").trim();
}

/**
 * Checks whether a candidate tag matches the target tag, including sub-tags.
 * E.g. "uni" matches "uni" and "uni/mathe", but not "unicorn".
 *
 * @param {string} candidateTag - Tag found in note frontmatter.
 * @param {string} targetTag - Target tag being searched for.
 * @returns {boolean} True if candidate matches target or is a sub-tag.
 */
function tagMatches(candidateTag, targetTag) {
    const candidate = normalizeTag(candidateTag).toLowerCase();
    const target = normalizeTag(targetTag).toLowerCase();
    if (!candidate || !target) return false;
    return candidate === target || candidate.startsWith(target + "/");
}

/**
 * Extracts all tags defined in the frontmatter of a note.
 * Checks both the Obsidian metadata cache and raw frontmatter YAML.
 *
 * @param {CachedMetadata|null} fileCache - Obsidian cache.
 * @param {string} fileContent - Full text of the file.
 * @returns {string[]} List of tag strings without '#'.
 */
function getFrontmatterTags(fileCache, fileContent) {
    const tags = new Set();

    function addRaw(val) {
        if (!val) return;
        if (typeof val === "string") {
            val.split(/[\s,]+/).forEach(t => {
                const norm = normalizeTag(t);
                if (norm) tags.add(norm);
            });
        } else if (Array.isArray(val)) {
            val.forEach(item => addRaw(item));
        }
    }

    // 1. Check parsed frontmatter in cache
    if (fileCache?.frontmatter) {
        if (fileCache.frontmatter.tags) addRaw(fileCache.frontmatter.tags);
        if (fileCache.frontmatter.tag) addRaw(fileCache.frontmatter.tag);
    }

    // 2. Check tags from cache that fall within frontmatter position
    if (fileCache?.tags && fileCache?.frontmatterPosition) {
        const fmEndOffset = fileCache.frontmatterPosition.end?.offset ?? Infinity;
        for (const t of fileCache.tags) {
            if (t.position && t.position.end && t.position.end.offset <= fmEndOffset) {
                const norm = normalizeTag(t.tag);
                if (norm) tags.add(norm);
            }
        }
    }

    // 3. Fallback: Parse raw YAML frontmatter if available
    if (fileContent) {
        const fmMatch = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
            const fmText = fmMatch[1];
            const tagBlockMatch = fmText.match(/^(?:tags|tag):\s*(.*(?:\r?\n(?:\s+-\s+.*|\s+.*))*)/m);
            if (tagBlockMatch) {
                const lines = tagBlockMatch[0].split(/\r?\n/);
                for (const line of lines) {
                    const listMatch = line.match(/^\s*-\s*["']?#?([^"'#\s\],]+)["']?/);
                    if (listMatch) {
                        const norm = normalizeTag(listMatch[1]);
                        if (norm) tags.add(norm);
                    } else {
                        const inline = line.replace(/^(?:tags|tag):\s*/i, "").trim();
                        if (inline) {
                            const cleaned = inline.replace(/^\[|\]$/g, "");
                            cleaned.split(/[\s,]+/).forEach(t => {
                                const norm = normalizeTag(t);
                                if (norm) tags.add(norm);
                            });
                        }
                    }
                }
            }
        }
    }

    return Array.from(tags);
}

/**
 * Checks whether a note contains the target tag in its frontmatter.
 *
 * @param {TFile} file - Note file to check.
 * @param {string} targetTag - Target tag being searched for.
 * @param {string} fileContent - Full text of the file.
 * @param {CachedMetadata|null} fileCache - Obsidian cache.
 * @returns {boolean} True if matching tag found in frontmatter.
 */
function containsTagInFrontmatter(file, targetTag, fileContent, fileCache) {
    const fmTags = getFrontmatterTags(fileCache, fileContent);
    return fmTags.some(tag => tagMatches(tag, targetTag));
}

/**
 * Collects all frontmatter tags across all markdown files in the vault and counts their occurrences.
 *
 * @param {App} app - Obsidian App instance.
 * @returns {Record<string, number>} Object mapping tag name to occurrence count.
 */
function collectVaultFrontmatterTags(app) {
    const tagCounts = {};
    const allFiles = app.vault.getMarkdownFiles();

    for (const file of allFiles) {
        const cache = app.metadataCache.getFileCache(file);
        if (cache?.frontmatter) {
            const rawTags = cache.frontmatter.tags ?? cache.frontmatter.tag;
            if (rawTags) {
                const add = (t) => {
                    if (typeof t === "string") {
                        t.split(/[\s,]+/).forEach(single => {
                            const norm = normalizeTag(single);
                            if (norm) {
                                tagCounts[norm] = (tagCounts[norm] || 0) + 1;
                            }
                        });
                    } else if (Array.isArray(t)) {
                        t.forEach(add);
                    }
                };
                add(rawTags);
            }
        }
    }

    return tagCounts;
}

/**
 * Ensures that a directory path exists in the vault, creating intermediate folders if necessary.
 *
 * @param {App} app - Obsidian App instance.
 * @param {string} folderPath - Target directory path relative to vault root.
 */
async function ensureFolderExists(app, folderPath) {
    if (!folderPath || folderPath === "/" || folderPath === ".") return;
    const cleanPath = folderPath.replace(/^\/+|\/+$/g, "");
    if (!cleanPath) return;

    const parts = cleanPath.split("/");
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const dir = app.vault.getAbstractFileByPath(current);
        if (!dir) {
            await app.vault.createFolder(current);
        }
    }
}

/**
 * Helper to display notices safely across Obsidian and test environments.
 *
 * @param {string} msg - Message to display.
 */
function showNotice(msg) {
    if (typeof Notice !== "undefined") {
        new Notice(msg);
    } else if (typeof window !== "undefined" && window.Notice) {
        new window.Notice(msg);
    } else {
        console.log("[Notice]:", msg);
    }
}

module.exports = async function (tp, options = {}) {
    const app = tp.app || window.app;

    // 1. Determine filter mode: "note" or "tag"
    let filterType = options.filterType;
    if (!filterType) {
        if (options.targetNote || options.targetFile) {
            filterType = "note";
        } else if (options.targetTag) {
            filterType = "tag";
        }
    }

    if (!filterType && tp.system) {
        const filterChoices = [
            "📝 Notiz (Notizen, die eine bestimmte Notiz referenzieren)",
            "🏷️ Tag (Notizen mit einem bestimmten Tag im Frontmatter)"
        ];
        const filterValues = ["note", "tag"];

        const chosenFilter = await tp.system.suggester(
            filterChoices,
            filterValues,
            false,
            "Wonach möchtest du filtern?"
        );

        if (!chosenFilter) {
            showNotice("Abgebrochen: Kein Filter-Typ ausgewählt.");
            return "";
        }
        filterType = chosenFilter;
    }

    if (!filterType) {
        filterType = "note"; // Fallback default
    }

    let targetFile = null;
    let targetTag = "";
    let cleanFolderName = "";
    let targetFolderPath = "";

    // 2. Resolve target based on selected filter type
    if (filterType === "note") {
        // --- NOTE FILTER MODE ---
        if (options.targetFile) {
            targetFile = typeof options.targetFile === "string"
                ? app.vault.getAbstractFileByPath(options.targetFile)
                : options.targetFile;
        } else if (options.targetNote) {
            if (typeof options.targetNote === "string") {
                const all = app.vault.getMarkdownFiles();
                targetFile = all.find(f => f.basename === options.targetNote || f.path === options.targetNote);
            } else {
                targetFile = options.targetNote;
            }
        }

        if (!targetFile && tp.system) {
            const activeFile = app.workspace.getActiveFile();
            const allFiles = app.vault.getMarkdownFiles();

            if (allFiles.length === 0) {
                showNotice("⚠️ Keine Markdown-Dateien im Vault gefunden!");
                return "";
            }

            const sortedFiles = allFiles.slice().sort((a, b) => {
                if (activeFile && a.path === activeFile.path) return -1;
                if (activeFile && b.path === activeFile.path) return 1;
                return a.basename.localeCompare(b.basename, "de", { sensitivity: "base" });
            });

            const displayNames = sortedFiles.map(f => {
                if (activeFile && f.path === activeFile.path) {
                    return `📌 ${f.basename} (Aktuelle Notiz)`;
                }
                return f.basename;
            });

            targetFile = await tp.system.suggester(
                displayNames,
                sortedFiles,
                false,
                "Wähle die Notiz aus, deren referenzierende Notizen verschoben werden sollen:"
            );
        }

        if (!targetFile) {
            showNotice("Abgebrochen: Keine Notiz ausgewählt.");
            return "";
        }

        cleanFolderName = targetFile.basename.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
        targetFolderPath = options.targetFolder
            ? options.targetFolder.replace(/^\/+|\/+$/g, "")
            : cleanFolderName;

    } else {
        // --- TAG FILTER MODE ---
        if (options.targetTag) {
            targetTag = normalizeTag(options.targetTag);
        }

        if (!targetTag && tp.system) {
            const tagCounts = collectVaultFrontmatterTags(app);
            const distinctTags = Object.keys(tagCounts).sort((a, b) =>
                a.localeCompare(b, "de", { sensitivity: "base" })
            );

            const displayLabels = [
                "✏️ Anderen Tag manuell eingeben...",
                ...distinctTags.map(t => `#${t} (${tagCounts[t]} Notiz${tagCounts[t] === 1 ? "" : "en"})`)
            ];
            const displayValues = [
                "__CUSTOM__",
                ...distinctTags
            ];

            const chosen = await tp.system.suggester(
                displayLabels,
                displayValues,
                false,
                "Wähle einen Tag aus (aus Frontmatter-Metadaten):"
            );

            if (chosen === undefined || chosen === null) {
                showNotice("Abgebrochen: Kein Tag ausgewählt.");
                return "";
            }

            if (chosen === "__CUSTOM__") {
                const entered = await tp.system.prompt("Welchen Tag möchtest du filtern? (ohne '#'):");
                if (!entered || !entered.trim()) {
                    showNotice("Abgebrochen: Kein Tag eingegeben.");
                    return "";
                }
                targetTag = normalizeTag(entered);
            } else {
                targetTag = normalizeTag(chosen);
            }
        }

        if (!targetTag) {
            showNotice("Abgebrochen: Kein Tag angegeben.");
            return "";
        }

        // Target folder for tags: preserve subfolder hierarchies (e.g. uni/mathe)
        cleanFolderName = targetTag.replace(/[\\:|#^\[\]*?"<>]/g, "").trim().replace(/^\/+|\/+$/g, "");
        targetFolderPath = options.targetFolder
            ? options.targetFolder.replace(/^\/+|\/+$/g, "")
            : cleanFolderName;
    }

    // 3. Determine the source folder to search in
    let sourceFolder = options.sourceFolder !== undefined ? options.sourceFolder : undefined;

    if (sourceFolder === undefined && tp.system && options.askSourceFolder !== false) {
        const folderSet = new Set();
        if (typeof app.vault.getAllLoadedFiles === "function") {
            for (const item of app.vault.getAllLoadedFiles()) {
                if (item.children && item.path && item.path !== "/") {
                    folderSet.add(item.path);
                }
            }
        }
        for (const file of app.vault.getMarkdownFiles()) {
            if (file.parent && file.parent.path && file.parent.path !== "/") {
                folderSet.add(file.parent.path);
            }
        }

        const sortedFolders = Array.from(folderSet).sort((a, b) =>
            a.localeCompare(b, "de", { sensitivity: "base" })
        );

        const folderLabels = [
            "📁 (Gesamter Vault - Alle Ordner)",
            ...sortedFolders.map(f => `📁 ${f}`)
        ];
        const folderValues = [
            null, // null = entire vault
            ...sortedFolders
        ];

        const promptTitle = filterType === "note"
            ? "Aus welchem Ordner soll nach referenzierenden Notizen gesucht werden?"
            : `Aus welchem Ordner soll nach Notizen mit Tag #${targetTag} gesucht werden?`;

        const chosenFolder = await tp.system.suggester(
            folderLabels,
            folderValues,
            false,
            promptTitle
        );

        if (chosenFolder === undefined) {
            showNotice("Abgebrochen: Kein Suchordner ausgewählt.");
            return "";
        }

        sourceFolder = chosenFolder;
    }

    // 4. Scan markdown files for matching criteria
    let allFiles = app.vault.getMarkdownFiles();

    // Filter by source folder if one was selected
    if (sourceFolder) {
        const cleanSource = sourceFolder.replace(/^\/+|\/+$/g, "");
        allFiles = allFiles.filter(file => {
            const parent = file.parent ? file.parent.path : "";
            return parent === cleanSource || file.path.startsWith(`${cleanSource}/`);
        });
    }

    const matchingFiles = [];

    for (const file of allFiles) {
        if (filterType === "note" && targetFile && file.path === targetFile.path) {
            continue; // Never move the referenced target note itself
        }

        const cache = app.metadataCache.getFileCache(file);
        let content = "";
        try {
            content = await app.vault.read(file);
        } catch (err) {
            console.error(`Fehler beim Lesen der Datei '${file.path}':`, err);
        }

        const isMatch = filterType === "note"
            ? containsNoteInMetadata(file, targetFile, content, cache)
            : containsTagInFrontmatter(file, targetTag, content, cache);

        if (isMatch) {
            matchingFiles.push(file);
        }
    }

    // 5. Handle case where no notes match
    if (matchingFiles.length === 0) {
        const sourceInfo = sourceFolder ? ` im Ordner "${sourceFolder}"` : "";
        if (filterType === "note") {
            showNotice(`ℹ️ Keine Notizen${sourceInfo} gefunden, die "${targetFile.basename}" in ihren Metadaten enthalten.`);
        } else {
            showNotice(`ℹ️ Keine Notizen${sourceInfo} gefunden, die den Tag "#${targetTag}" im Frontmatter enthalten.`);
        }
        return "";
    }

    // 6. Ensure destination folder exists
    try {
        await ensureFolderExists(app, targetFolderPath);
    } catch (err) {
        console.error(`Fehler beim Erstellen des Ordners '${targetFolderPath}':`, err);
        showNotice(`❌ Fehler beim Erstellen des Ordners "${targetFolderPath}": ${err.message}`);
        return "";
    }

    // 7. Move matching files to target folder
    let movedCount = 0;
    let alreadyInFolderCount = 0;
    let errorCount = 0;

    for (const file of matchingFiles) {
        const targetParent = file.parent ? file.parent.path : "";
        if (targetParent === targetFolderPath) {
            alreadyInFolderCount++;
            continue;
        }

        const newPath = `${targetFolderPath}/${file.name}`;
        let candidatePath = newPath;
        let counter = 1;
        const baseNameWithoutExt = file.basename;
        const ext = file.extension ? `.${file.extension}` : (file.name.endsWith(".md") ? ".md" : "");

        while (app.vault.getAbstractFileByPath(candidatePath) && candidatePath !== file.path) {
            candidatePath = `${targetFolderPath}/${baseNameWithoutExt} (${counter++})${ext}`;
        }

        try {
            await app.fileManager.renameFile(file, candidatePath);
            movedCount++;
        } catch (err) {
            console.error(`Fehler beim Verschieben von '${file.path}':`, err);
            errorCount++;
        }
    }

    // 8. User feedback
    const sourceInfo = sourceFolder ? ` aus "${sourceFolder}"` : "";
    if (movedCount > 0) {
        let msg = "";
        if (filterType === "note") {
            msg = `✅ ${movedCount} Notiz(en)${sourceInfo} erfolgreich in den Ordner "${targetFolderPath}" verschoben!`;
        } else {
            msg = `✅ ${movedCount} Notiz(en)${sourceInfo} mit Tag "#${targetTag}" erfolgreich in den Ordner "${targetFolderPath}" verschoben!`;
        }

        if (alreadyInFolderCount > 0) {
            msg += `\n(${alreadyInFolderCount} Notiz(en) befanden sich bereits im Ordner)`;
        }
        if (errorCount > 0) {
            msg += `\n⚠️ Bei ${errorCount} Notiz(en) gab es einen Fehler.`;
        }
        showNotice(msg);
    } else if (alreadyInFolderCount > 0) {
        if (filterType === "note") {
            showNotice(`ℹ️ Alle ${alreadyInFolderCount} referenzierenden Notizen befinden sich bereits im Ordner "${targetFolderPath}".`);
        } else {
            showNotice(`ℹ️ Alle ${alreadyInFolderCount} Notizen mit Tag "#${targetTag}" befinden sich bereits im Ordner "${targetFolderPath}".`);
        }
    } else if (errorCount > 0) {
        showNotice("❌ Fehler beim Verschieben der Notizen.");
    }

    return "";
};
