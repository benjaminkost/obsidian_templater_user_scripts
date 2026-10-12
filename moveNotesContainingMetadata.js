/**
 * Templater User Script: moveNotesContainingMetadata
 *
 * Prompts the user to select a target note via a suggester.
 * Scans the vault for all other notes that reference the target note anywhere in their metadata/frontmatter
 * (e.g. in 'up', 'parent', 'tags', or custom frontmatter properties).
 * Automatically moves all matching notes into a separate folder named after the target note,
 * while leaving the target note itself at its current location.
 *
 * Usage:
 * 1) Interactively in a template or hotkey:
 *    <%* await tp.user.moveNotesContainingMetadata(tp) -%>
 *
 * 2) Calling with options:
 *    <%* await tp.user.moveNotesContainingMetadata(tp, {
 *        targetNote: "MyParentNote", // optional, skips note suggester
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

    // 1. Resolve the target note
    let targetFile = null;
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

    // 2. If not specified, prompt the user with a suggester
    if (!targetFile && tp.system) {
        const activeFile = app.workspace.getActiveFile();
        const allFiles = app.vault.getMarkdownFiles();

        if (allFiles.length === 0) {
            showNotice("⚠️ Keine Markdown-Dateien im Vault gefunden!");
            return;
        }

        // Sort files alphabetically, placing currently active file at the top
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
        return;
    }

    // 2b. Determine the source folder to search in
    let sourceFolder = options.sourceFolder !== undefined ? options.sourceFolder : undefined;

    if (sourceFolder === undefined && tp.system && options.askSourceFolder !== false) {
        // Collect all distinct folder paths present in the vault
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

        const chosenFolder = await tp.system.suggester(
            folderLabels,
            folderValues,
            false,
            "Aus welchem Ordner soll nach referenzierenden Notizen gesucht werden?"
        );

        if (chosenFolder === undefined) {
            showNotice("Abgebrochen: Kein Suchordner ausgewählt.");
            return;
        }

        sourceFolder = chosenFolder;
    }

    // 3. Determine the target folder (named after the target note at vault root level)
    const cleanFolderName = targetFile.basename.replace(/[\\/:|#^\[\]*?"<>]/g, "").trim();
    const targetFolderPath = options.targetFolder
        ? options.targetFolder.replace(/^\/+|\/+$/g, "")
        : cleanFolderName;

    // 4. Scan markdown files for metadata referencing the target note
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
        if (file.path === targetFile.path) continue;

        const cache = app.metadataCache.getFileCache(file);
        let content = "";
        try {
            content = await app.vault.read(file);
        } catch (err) {
            console.error(`Fehler beim Lesen der Datei '${file.path}':`, err);
        }

        if (containsNoteInMetadata(file, targetFile, content, cache)) {
            matchingFiles.push(file);
        }
    }

    if (matchingFiles.length === 0) {
        if (sourceFolder) {
            showNotice(`ℹ️ Keine Notizen im Ordner "${sourceFolder}" gefunden, die "${targetFile.basename}" in ihren Metadaten enthalten.`);
        } else {
            showNotice(`ℹ️ Keine Notizen gefunden, die "${targetFile.basename}" in ihren Metadaten enthalten.`);
        }
        return;
    }

    // 5. Ensure the destination folder exists
    try {
        await ensureFolderExists(app, targetFolderPath);
    } catch (err) {
        console.error(`Fehler beim Erstellen des Ordners '${targetFolderPath}':`, err);
        showNotice(`❌ Fehler beim Erstellen des Ordners "${cleanFolderName}": ${err.message}`);
        return;
    }

    // 6. Move matching files to the target folder
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

    // 7. User feedback
    if (movedCount > 0) {
        const sourceInfo = sourceFolder ? ` aus "${sourceFolder}"` : "";
        let msg = `✅ ${movedCount} Notiz(en)${sourceInfo} erfolgreich in den Ordner "${cleanFolderName}" verschoben!`;
        if (alreadyInFolderCount > 0) {
            msg += `\n(${alreadyInFolderCount} Notiz(en) befanden sich bereits im Ordner)`;
        }
        if (errorCount > 0) {
            msg += `\n⚠️ Bei ${errorCount} Notiz(en) gab es einen Fehler.`;
        }
        showNotice(msg);
    } else if (alreadyInFolderCount > 0) {
        showNotice(`ℹ️ Alle ${alreadyInFolderCount} referenzierenden Notizen befinden sich bereits im Ordner "${cleanFolderName}".`);
    } else if (errorCount > 0) {
        showNotice(`❌ Fehler beim Verschieben der Notizen.`);
    }

    return "";
};
