/**
 * Templater User Script: transformUppercaseTitle
 *
 * Transforms all-caps or unformatted titles/headings into clean title case.
 *
 * Examples:
 *   "EINFÜHRUNG: SIGNALE UND SYSTEME" -> "Einführung Signale und Systeme"
 *   "SIGNALE UND SYSTEME" (with prefix "Einführung") -> "Einführung Signale und Systeme"
 *
 * Key features:
 *   - Strips colons and invalid Obsidian filename characters.
 *   - Converts words into proper German capitalized title casing (e.g. Einführung, Signale, Systeme).
 *   - Keeps German conjunctions and minor words lowercase (e.g. und, oder, der, die, das, in, für, mit, von), unless at the beginning.
 *   - Keeps technical acronyms in UPPERCASE (e.g. LTI, FFT, TUM, EMF, VL, WS, Roman numerals).
 *   - Preserves 12-digit Zettelkasten timestamp prefixes (YYYYMMDDHHmm - ...) and outline numbers (1.1 ...).
 *   - Handles hyphenated words correctly (e.g. FOURIER-TRANSFORMATION -> Fourier-Transformation, LTI-SYSTEME -> LTI-Systeme).
 *   - Supports optional prefix (e.g. options.prefix = "Einführung").
 *
 * Invocation:
 *   1) Direct string function:
 *      <% tp.user.transformUppercaseTitle("EINFÜHRUNG: SIGNALE UND SYSTEME") %>
 *
 *   2) In an active note or template:
 *      <%* await tp.user.transformUppercaseTitle(tp) -%>
 *      - If text is selected in the editor, transforms the selection immediately.
 *      - Otherwise presents a menu: rename active note, convert headings in note, or manual input.
 */

const DEFAULT_UPPERCASE_WORDS = new Set([
    // Logic operators (excluding common conjunctions like 'und'/'oder'/'and'/'or')
    "NICHT", "NOT", "XOR", "NAND", "NOR",
    // Universities & courses
    "TUM", "LMU", "KIT", "ETH", "RWTH",
    "EMF", "VL", "WS", "SS", "UE", "ÜB", "PR", "SE",
    // Engineering, math & physics acronyms
    "LTI", "FFT", "DFT", "FIR", "IIR", "SNR", "BODE",
    "PID", "PT1", "PT2",
    "MATLAB", "CAD", "PDF", "API", "KI", "AI", "ML", "DL", "NLP",
    "CPU", "GPU", "RAM", "ROM", "SSD", "HDD", "ALU", "DSP", "FPGA", "ASIC",
    "AC", "DC", "HF", "NF", "EMV", "ESD",
    "OP", "OPV", "BJT", "FET", "MOSFET", "CMOS", "TTL", "LED", "SMD", "PCB",
    "USB", "CAN", "SPI", "I2C", "UART", "GPIO", "PWM",
    "HTML", "CSS", "JS", "TS", "JSON", "SQL", "GUI", "CLI", "IDE", "OS",
    "TCP", "IP", "UDP", "HTTP", "HTTPS", "DNS", "SSH", "FTP",
    // Roman numerals (I - XX)
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
    "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"
]);

const GERMAN_MINOR_WORDS = new Set([
    "und", "oder", "sowie", "wie", "als", "bzw",
    "der", "die", "das", "des", "dem", "den",
    "ein", "eine", "einer", "eines", "einem", "einen",
    "in", "im", "an", "am", "auf", "aus", "bei", "beim", "mit", "nach",
    "von", "vom", "zu", "zum", "zur", "für", "über", "unter", "vor"
]);

/**
 * Formats a single word into proper casing, taking acronyms and German minor words into account.
 *
 * @param {string} rawWord - Raw word token.
 * @param {boolean} isFirstWord - Whether this is the first word of the title.
 * @param {Set<string>} uppercaseSet - Set of words that must remain uppercase.
 * @returns {string} Formatted word.
 */
function formatWord(rawWord, isFirstWord = false, uppercaseSet = DEFAULT_UPPERCASE_WORDS) {
    if (!rawWord) return "";

    const upper = rawWord.toUpperCase();
    if (uppercaseSet.has(upper)) {
        return upper;
    }

    // Check if word has digits attached to a recognized uppercase acronym (e.g. WS2627, SS26, VL01, PT1)
    const alphaNumMatch = rawWord.match(/^([a-zA-ZäöüÄÖÜß]+)(\d+.*)$/);
    if (alphaNumMatch && uppercaseSet.has(alphaNumMatch[1].toUpperCase())) {
        return alphaNumMatch[1].toUpperCase() + alphaNumMatch[2];
    }

    // Handle hyphenated words (e.g. FOURIER-TRANSFORMATION, LTI-SYSTEME)
    if (rawWord.includes("-")) {
        return rawWord
            .split("-")
            .map((part, idx) => formatWord(part, isFirstWord && idx === 0, uppercaseSet))
            .join("-");
    }

    const lower = rawWord.toLowerCase();
    // Minor German words stay lowercase unless it's the very first word
    if (!isFirstWord && GERMAN_MINOR_WORDS.has(lower)) {
        return lower;
    }

    // Capitalize first character, lowercase the rest (supports German umlauts)
    return rawWord.charAt(0).toUpperCase() + rawWord.slice(1).toLowerCase();
}

/**
 * Transforms an input title string according to formatting rules.
 *
 * @param {string} title - Input title string.
 * @param {object} options - Optional configuration options.
 * @returns {string} Formatted title string.
 */
function transformTitle(title, options = {}) {
    if (!title) return "";
    let str = String(title).trim();

    // 1. Preserve 12-digit Zettelkasten prefix: YYYYMMDDHHmm - ...
    let zkPrefix = "";
    const zkMatch = str.match(/^(\d{12}\s*-\s*)(.+)$/);
    if (zkMatch) {
        zkPrefix = zkMatch[1];
        str = zkMatch[2];
    }

    // 2. Preserve leading structure numbering like "1. ", "1.1 ", "1.1.2 "
    let numPrefix = "";
    const numMatch = str.match(/^((?:\d+[\.\-_)]?\s*)+)(.+)$/);
    if (numMatch && !/^\d{12}/.test(numMatch[1])) {
        numPrefix = numMatch[1];
        str = numMatch[2];
    }

    // 3. Remove colons and invalid Obsidian title characters: \ / | # ^ [ ] * ? " < >
    str = str.replace(/:/g, " ");
    str = str.replace(/[\\/|#^\[\]*?"<>]/g, "");

    // 4. Build uppercase words set with any custom additions
    let uppercaseSet = DEFAULT_UPPERCASE_WORDS;
    if (options.customUppercaseWords && Array.isArray(options.customUppercaseWords)) {
        uppercaseSet = new Set([...DEFAULT_UPPERCASE_WORDS, ...options.customUppercaseWords.map(w => w.toUpperCase())]);
    } else if (options.uppercaseWords instanceof Set) {
        uppercaseSet = options.uppercaseWords;
    }

    // 5. Tokenize by whitespace
    const tokens = str.split(/\s+/).filter(t => t.length > 0);
    const formattedTokens = tokens.map((token, idx) => {
        // Extract leading punctuation (e.g. '(', '"', '[')
        const leadMatch = token.match(/^([^a-zA-Z0-9äöüÄÖÜß]+)(.*)$/);
        let leadPunct = "";
        let core = token;
        if (leadMatch) {
            leadPunct = leadMatch[1];
            core = leadMatch[2];
        }

        // Extract trailing punctuation (e.g. ')', '"', ']', ',')
        const trailMatch = core.match(/^(.*?)([^a-zA-Z0-9äöüÄÖÜß]+)$/);
        let trailPunct = "";
        if (trailMatch) {
            core = trailMatch[1];
            trailPunct = trailMatch[2];
        }

        const formattedCore = formatWord(core, idx === 0, uppercaseSet);
        return leadPunct + formattedCore + trailPunct;
    });

    let result = formattedTokens.join(" ");

    // Handle optional prefix (e.g. options.prefix = "Einführung")
    if (options.prefix && typeof options.prefix === "string") {
        const cleanPrefix = options.prefix.trim();
        if (cleanPrefix && !result.toLowerCase().startsWith(cleanPrefix.toLowerCase())) {
            result = `${cleanPrefix} ${result}`;
        }
    }

    return zkPrefix + numPrefix + result;
}

/**
 * Transforms all markdown headings (#, ##, ...) inside content.
 *
 * @param {string} content - Markdown file content.
 * @param {object} options - Options passed to transformTitle.
 * @returns {{ text: string, count: number }} Updated content and count of modified headings.
 */
function transformHeadingsInContent(content, options = {}) {
    const lines = content.split(/\r?\n/);
    let inFence = false;
    let count = 0;

    const newLines = lines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        const headingMatch = line.match(/^(#{1,6}\s+)(.+)$/);
        if (headingMatch) {
            const hashes = headingMatch[1];
            const originalText = headingMatch[2];
            const transformed = transformTitle(originalText, options);
            if (transformed !== originalText) {
                count++;
                return `${hashes}${transformed}`;
            }
        }
        return line;
    });

    return { text: newLines.join("\n"), count };
}

function showNotice(msg) {
    if (typeof Notice !== "undefined") {
        new Notice(msg);
    } else {
        console.log(msg);
    }
}

/**
 * Main export function for Templater.
 *
 * Supports:
 *   - Direct string invocation: tp.user.transformUppercaseTitle("EINFÜHRUNG: SIGNALE UND SYSTEME") (returns string synchronously)
 *   - Interactive Templater usage: await tp.user.transformUppercaseTitle(tp, options) (returns Promise)
 */
module.exports = function (tp, options = {}) {
    // Direct string invocation support: tp.user.transformUppercaseTitle("MY TITLE")
    if (typeof tp === "string") {
        return transformTitle(tp, typeof options === "object" ? options : {});
    }

    // Direct invocation with text option: tp.user.transformUppercaseTitle(tp, "MY TITLE")
    if (typeof options === "string") {
        return transformTitle(options);
    }

    if (options && typeof options.text === "string") {
        return transformTitle(options.text, options);
    }

    return (async () => {
        const app = (tp && tp.app) || window.app;
        if (!app) {
            return transformTitle(String(options || ""));
        }

        // Check if user has an active editor selection in Obsidian
        let activeEditor = null;
        let selectedText = "";

        try {
            if (tp.file && typeof tp.file.selection === "function") {
                selectedText = tp.file.selection();
            }
        } catch (e) {
            // Fallback to workspace active view
        }

        if (!selectedText && app.workspace) {
            const activeView = (typeof app.workspace.getActiveViewOfType === "function" && tp.obsidian)
                ? app.workspace.getActiveViewOfType(tp.obsidian.MarkdownView)
                : (app.workspace.activeLeaf && app.workspace.activeLeaf.view);
            if (activeView && activeView.editor) {
                activeEditor = activeView.editor;
                if (typeof activeEditor.getSelection === "function") {
                    selectedText = activeEditor.getSelection();
                }
            }
        }

        // If text is selected in the editor, transform it directly
        if (selectedText && selectedText.trim().length > 0) {
            const transformedSelection = transformTitle(selectedText, options);
            if (activeEditor && typeof activeEditor.replaceSelection === "function") {
                activeEditor.replaceSelection(transformedSelection);
            }
            showNotice(`✅ Textauswahl umgewandelt:\n"${transformedSelection}"`);
            return transformedSelection;
        }

        // Identify target file
        let targetFile = null;
        if (options.targetFile) {
            targetFile = typeof options.targetFile === "string"
                ? app.vault.getAbstractFileByPath(options.targetFile)
                : options.targetFile;
        } else if (tp.config && tp.config.target_file) {
            targetFile = tp.config.target_file;
        } else if (app.workspace && typeof app.workspace.getActiveFile === "function") {
            targetFile = app.workspace.getActiveFile();
        }

    // If no specific mode requested and tp.system is available, show a selection menu
    let mode = options.mode;
    if (!mode && tp.system) {
        const choices = [
            "📝 Aktuellen Notiztitel umbenennen & anpassen",
            "📑 Alle Überschriften (# ...) in dieser Notiz anpassen",
            "✍️ Text manuell eingeben & umwandeln"
        ];
        const values = ["rename", "headings", "prompt"];

        mode = await tp.system.suggester(choices, values, false, "Was möchtest du umwandeln?");
    }

    if (!mode) {
        return "";
    }

    // Mode 1: Rename active note
    if (mode === "rename") {
        if (!targetFile) {
            showNotice("❌ Keine aktive Notiz zum Umbenennen gefunden!");
            return "";
        }

        const currentBaseName = targetFile.basename;
        const transformedBaseName = transformTitle(currentBaseName, options);

        if (transformedBaseName === currentBaseName) {
            showNotice(`ℹ️ Notiztitel ist bereits sauber formatiert:\n"${currentBaseName}"`);
            return currentBaseName;
        }

        const parentPath = targetFile.parent ? targetFile.parent.path : "";
        const newFileName = `${transformedBaseName}.md`;
        const newPath = parentPath && parentPath !== "/" ? `${parentPath}/${newFileName}` : newFileName;

        try {
            await app.fileManager.renameFile(targetFile, newPath);
            showNotice(`✅ Notiz umbenannt in:\n"${transformedBaseName}"`);
        } catch (error) {
            console.error("Fehler beim Umbenennen der Datei:", error);
            showNotice(`❌ Fehler beim Umbenennen: ${error.message}`);
        }
        return transformedBaseName;
    }

    // Mode 2: Transform headings in active note
    if (mode === "headings") {
        if (!targetFile) {
            showNotice("❌ Keine aktive Notiz gefunden!");
            return "";
        }

        const content = await app.vault.read(targetFile);
        const { text: newContent, count } = transformHeadingsInContent(content, options);

        if (count === 0) {
            showNotice("ℹ️ Keine Überschriften zum Umwandeln gefunden.");
            return "";
        }

        await app.vault.modify(targetFile, newContent);
        showNotice(`✅ ${count} Überschrift${count === 1 ? "" : "en"} erfolgreich angepasst!`);
        return "";
    }

    // Mode 3: Manual text prompt
    if (mode === "prompt") {
        const input = await tp.system.prompt("Gib den Text ein, der umgewandelt werden soll (z. B. 'EINFÜHRUNG: SIGNALE UND SYSTEME'):");
        if (!input) {
            return "";
        }

        const transformed = transformTitle(input, options);
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(transformed);
            showNotice(`✅ Umgewandelt & in die Zwischenablage kopiert:\n"${transformed}"`);
        } else {
            showNotice(`✅ Umgewandelt:\n"${transformed}"`);
        }
        return transformed;
    }

        return "";
    })();
}