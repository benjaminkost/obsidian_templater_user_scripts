/**
 * Templater User Script: createSimulationFromSelection
 *
 * Generates an interactive HTML5 simulation/visualization for the currently
 * selected text or formula in the active note using Google Gemini (via the API
 * key stored in Obsidian Copilot's SecretStorage, with fallback to OpenCode CLI),
 * saves the generated .html file in "2 - Source Material/Animations", and
 * inserts a [[...html]] reference together with a live dataviewjs iframe
 * renderer directly below the selected text/formula.
 *
 * Usage in Templater template:
 *   <%* await tp.user.createSimulationFromSelection(tp) -%>
 *
 * Programmatic usage / options:
 *   await tp.user.createSimulationFromSelection(tp, {
 *       targetFile: TFile | "path/to/note.md",
 *       selection: "$$P_B = \\frac{1}{2} \\hat{U} \\hat{I} \\sin(\\varphi)$$",
 *       outputFolder: "2 - Source Material/Animations",
 *       fileName: "Simulation - Blindleistung.html",
 *       apiKey: "optional-api-key",
 *       model: "gemini-2.5-flash",
 *       customGenerator: async (prompt, context) => "<!DOCTYPE html>...",
 *       overwrite: false,
 *       silent: false
 *   });
 */

const DEFAULT_OUTPUT_FOLDER = "2 - Source Material/Animations";

const DEFAULT_GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
];

const COPILOT_GOOGLE_KEYCHAIN_ID = "copilot-v23cad57b-provider-google-api-key";

/**
 * Strips leading Zettelkasten timestamp prefix (e.g. "202602052302 - ") from a note title.
 *
 * @param {string} title - Raw note basename or title.
 * @returns {string} Cleaned title without timestamp prefix.
 */
function stripTimestampPrefix(title) {
    if (!title || typeof title !== "string") return "";
    return title.replace(/^\d{8,14}\s*-\s*/, "").trim();
}

/**
 * Sanitizes a string for safe use as a filename across macOS/Windows/Linux.
 *
 * @param {string} raw - Input name string.
 * @param {number} [maxLen=60] - Maximum length of the resulting base name.
 * @returns {string} Sanitized filename segment (without extension).
 */
function sanitizeFileName(raw, maxLen = 60) {
    if (!raw || typeof raw !== "string") return "Visualisierung";
    let cleaned = raw
        // Strip LaTeX math delimiters and common formatting commands
        .replace(/\$\$?/g, "")
        .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^}]*)\}/g, "$1")
        .replace(/\\[a-zA-Z]+/g, " ")
        .replace(/[\{\}\[\]\(\)\^_~`#*]/g, " ")
        // Replace illegal path characters
        .replace(/[\/\\:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (cleaned.length > maxLen) {
        cleaned = cleaned.slice(0, maxLen).replace(/\s+\S*$/, "").trim();
    }

    cleaned = cleaned.replace(/^[-.\s]+|[-.\s]+$/g, "");
    return cleaned || "Visualisierung";
}

/**
 * Derives a descriptive HTML filename ("Simulation - <Topic>.html") from the
 * generated HTML <title>, explicit option, selected text, or note title.
 *
 * @param {object} params
 * @param {string} [params.explicitFileName] - User-provided filename override.
 * @param {string} [params.htmlContent] - Generated HTML content (checked for <title>).
 * @param {string} [params.selection] - Selected text or formula.
 * @param {string} [params.noteTitle] - Active note basename.
 * @returns {string} Filename ending in ".html".
 */
function deriveSimulationFileName({ explicitFileName, htmlContent, selection, noteTitle } = {}) {
    if (explicitFileName && typeof explicitFileName === "string" && explicitFileName.trim()) {
        const trimmed = explicitFileName.trim();
        const base = sanitizeFileName(trimmed.replace(/\.html?$/i, ""), 80);
        return `${base}.html`;
    }

    // 1. Try <title> from the generated HTML if meaningful
    if (htmlContent && typeof htmlContent === "string") {
        const titleMatch = htmlContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            let extracted = titleMatch[1]
                .replace(/^(?:Simulation|Visualisierung|Animation)\s*[:\-–—]\s*/i, "")
                .trim();
            const cleanExtracted = sanitizeFileName(extracted, 55);
            if (
                cleanExtracted &&
                cleanExtracted.length >= 3 &&
                !/^(?:simulation|visualisierung|index|document|test|untitled)$/i.test(cleanExtracted)
            ) {
                return `Simulation - ${cleanExtracted}.html`;
            }
        }
    }

    // 2. Try note title (cleaned of Zettelkasten timestamp)
    const cleanNote = sanitizeFileName(stripTimestampPrefix(noteTitle || ""), 50);
    if (cleanNote && cleanNote !== "Visualisierung") {
        return `Simulation - ${cleanNote}.html`;
    }

    // 3. Fall back to cleaned selection snippet
    const cleanSel = sanitizeFileName(selection || "", 45);
    return `Simulation - ${cleanSel}.html`;
}

/**
 * Injects an auto-resize postMessage script into the HTML document so that the
 * host DataviewJS iframe in Obsidian automatically adapts its height to the content.
 *
 * @param {string} html - Complete HTML document string.
 * @returns {string} HTML document with auto-resize observer injected.
 */
function injectAutoResizeScript(html) {
    if (!html || typeof html !== "string") return "";
    if (html.includes("sim-resize")) return html;

    const resizeSnippet = `
<script>
(function() {
  function notifyHeight() {
    var body = document.body;
    var docEl = document.documentElement;
    if (!body || !docEl) return;
    var h = Math.max(body.scrollHeight, body.offsetHeight, docEl.offsetHeight);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "sim-resize", height: h }, "*");
    }
  }
  window.addEventListener("load", function() {
    notifyHeight();
    setTimeout(notifyHeight, 150);
    setTimeout(notifyHeight, 500);
  });
  window.addEventListener("resize", notifyHeight);
  if (typeof ResizeObserver !== "undefined" && document.body) {
    new ResizeObserver(notifyHeight).observe(document.body);
  } else {
    document.addEventListener("DOMContentLoaded", function() {
      notifyHeight();
      if (typeof ResizeObserver !== "undefined" && document.body) {
        new ResizeObserver(notifyHeight).observe(document.body);
      }
    });
  }
})();
</script>`;

    if (/<\/body>/i.test(html)) {
        return html.replace(/<\/body>/i, `${resizeSnippet}\n</body>`);
    }
    if (/<\/html>/i.test(html)) {
        return html.replace(/<\/html>/i, `${resizeSnippet}\n</html>`);
    }
    return html + resizeSnippet;
}

/**
 * Extracts a clean, standalone HTML document from an LLM response string.
 * Strips markdown code fences (```html ... ```) and surrounding prose if present.
 *
 * @param {string} rawResponse - Raw LLM output text.
 * @returns {string} Extracted HTML document string, or empty string if invalid.
 */
function extractHtmlDocument(rawResponse) {
    if (!rawResponse || typeof rawResponse !== "string") return "";
    let text = rawResponse.trim();

    // 1. Check for ```html ... ``` fenced code block
    const fenceMatch = text.match(/```(?:html|htm)?\s*\r?\n([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1] && /<(?:!DOCTYPE|html|head|body|div|canvas|svg|script|style)/i.test(fenceMatch[1])) {
        text = fenceMatch[1].trim();
    }

    // 2. If there is prose before <!DOCTYPE html> or <html, slice from there to </html>
    const docTypeIdx = text.search(/<!DOCTYPE\s+html/i);
    const htmlTagIdx = text.search(/<html[\s>]/i);
    const startIdx = docTypeIdx !== -1 ? docTypeIdx : htmlTagIdx;

    if (startIdx !== -1) {
        const endMatch = text.match(/<\/html\s*>/i);
        if (endMatch && endMatch.index !== undefined && endMatch.index > startIdx) {
            text = text.slice(startIdx, endMatch.index + endMatch[0].length).trim();
        } else {
            text = text.slice(startIdx).trim();
            if (!/<\/html\s*>$/i.test(text)) {
                text += "\n</html>";
            }
        }
        return injectAutoResizeScript(text);
    }

    // 3. If the model returned an HTML fragment (e.g. <div>...<script>...</script></div>), wrap it
    if (/<(?:div|canvas|svg|style|script|section|main)[\s>]/i.test(text)) {
        const wrapped = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Simulation</title>
  <style>
    body { margin: 0; padding: 16px; background: #1e1e1e; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
</head>
<body>
${text}
</body>
</html>`;
        return injectAutoResizeScript(wrapped);
    }

    return "";
}

/**
 * Builds the prompt instructing the LLM to generate a self-contained, interactive
 * HTML5 simulation/visualization for the selected formula or text.
 *
 * @param {object} params
 * @param {string} params.selection - Selected text or formula.
 * @param {string} [params.noteTitle] - Active note title for context.
 * @param {string} [params.surroundingContext] - Nearby lines from the note.
 * @param {string} [params.customInstructions] - Optional additional hint from the user.
 * @returns {string} Prompt string for the LLM.
 */
function buildSimulationPrompt({ selection, noteTitle, surroundingContext, customInstructions }) {
    const cleanTitle = stripTimestampPrefix(noteTitle || "") || "Unbekannte Notiz";
    const contextSection = surroundingContext && surroundingContext.trim()
        ? `\nKontext aus der aktuellen Notiz ("${cleanTitle}"):\n"""\n${surroundingContext.trim()}\n"""\n`
        : `\nNotiz-Titel: "${cleanTitle}"\n`;
    const extraSection = customInstructions && customInstructions.trim()
        ? `\nZusätzliche Hinweise des Nutzers:\n${customInstructions.trim()}\n`
        : "";

    return `Du bist ein Experte für didaktische Physik-, Elektrotechnik-, Mathematik- und Informatik-Simulationen sowie interaktive wissenschaftliche Visualisierungen.

Erstelle eine **vollständige, interaktive, in sich geschlossene HTML5-Simulation / Visualisierung** (in einer einzigen .html-Datei mit Inline-CSS und Inline-JavaScript) für folgenden markierten Text bzw. folgende Formel:

Markierter Inhalt:
"""
${selection.trim()}
"""
${contextSection}${extraSection}
Anforderungen an die HTML-Datei:
1. **Vollständiges HTML5-Dokument**: Beginne mit \`<!DOCTYPE html><html lang="de">\` und ende mit \`</html>\`. Setze einen kurzen, prägnanten \`<title>Simulation - [Thema]</title>\`.
2. **Keine externen Abhängigkeiten**: Nutze natives HTML5 \`<canvas>\` oder \`<svg>\`, modernes CSS und Vanilla-JavaScript, damit die Simulation komplett offline in einem Obsidian-Iframe (\`srcdoc\`) ohne externe CDN-Blockaden sofort läuft.
3. **Interaktivität & Didaktik**:
   - Baue anschauliche Schieberegler (\`<input type="range">\`) und ggf. Buttons (z. B. Start/Pause, Reset, Modus-Umschalter) für die relevanten Größen/Parameter der Formel oder des Konzepts ein.
   - Zeige die aktuellen Zahlenwerte der Parameter sowie das berechnete Ergebnis live neben den Reglern bzw. in einer Statusleiste an.
   - Stelle den physikalischen, mathematischen oder algorithmischen Zusammenhang visuell und dynamisch dar (z. B. animierte Wellen/Zeiger/Felder/Ladungsträger, Funktionsgraphen, Vektoren oder Schritt-für-Schritt-Zustände).
4. **Design (Obsidian Dark Theme)**:
   - Dunkler Hintergrund (\`#1e1e1e\` / \`#18181b\`), Karten/Container in \`#252529\` mit dezentem Rahmen \`#38383e\`, gut lesbare helle Schrift (\`#e5e7eb\`, Sekundärtext \`#9ca3af\`).
   - Klare Akzentfarben für verschiedene Größen: Cyan (\`#00d2ff\`), Orange/Gold (\`#ffb43c\`), Korallrot (\`#ff5555\`), Grün (\`#50fa7b\`), Violett (\`#bd93f9\`).
   - Kompaktes, responsives Layout (Gesamthöhe idealerweise ca. 420px–560px), keine unnötigen äußeren Abstände.
5. **Sprache**: Alle Beschriftungen, Legenden und kurzen Erklärungen auf **Deutsch**.

WICHTIG: Antworte **ausschließlich** mit dem vollständigen HTML-Code (keine einleitenden oder abschließenden Erklärungen außerhalb des HTML-Dokuments).`;
}

/**
 * Builds the markdown block to insert below the selected text/formula.
 * Creates a compact dataviewjs block that renders the HTML file live inside an iframe.
 *
 * @param {string} fileName - Name of the HTML file (e.g. "Simulation - Blindleistung.html").
 * @param {string} vaultRelativePath - Full vault-relative path (e.g. "2 - Source Material/Animations/Simulation - Blindleistung.html").
 * @returns {string} Markdown dataviewjs renderer block.
 */
function buildSimulationEmbedBlock(fileName, vaultRelativePath) {
    const escapedPath = String(vaultRelativePath || fileName).replace(/\\/g, "/").replace(/"/g, '\\"');
    const escapedName = String(fileName).replace(/"/g, '\\"');

    return `\`\`\`dataviewjs
const htmlFile = app.vault.getAbstractFileByPath("${escapedPath}")
  || app.metadataCache.getFirstLinkpathDest("${escapedName}", dv.current()?.file?.path || "");
if (htmlFile) {
  const html = await app.vault.read(htmlFile);
  const iframe = dv.el("iframe", "");
  iframe.srcdoc = html;
  iframe.style.cssText = "width:100%; height:520px; border:1px solid #333; border-radius:10px; background:#1e1e1e;";
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "sim-resize" && e.source === iframe.contentWindow) {
      iframe.style.height = Math.min(Math.max(e.data.height + 16, 320), 900) + "px";
    }
  });
} else {
  dv.paragraph("⚠️ Simulationsdatei nicht gefunden: ${escapedName}");
}
\`\`\``;
}

/**
 * Determines the line index after which the simulation block should be inserted.
 * Ensures that:
 * - If the selection ends inside a multi-line $$...$$ math block, insertion happens after the closing $$.
 * - If the immediately following line is a block ID (^abc123) or footnote reference ([^1]), insertion happens after it.
 *
 * @param {string[]} lines - Array of lines in the document.
 * @param {number} selectionEndLine - 0-based line index where the selection ends.
 * @returns {number} 0-based line index after which to insert the simulation block.
 */
function findInsertionLineIndex(lines, selectionEndLine) {
    if (!Array.isArray(lines) || lines.length === 0) return 0;
    let idx = Math.max(0, Math.min(selectionEndLine, lines.length - 1));

    // Check if selectionEndLine is inside an unclosed multi-line $$ ... $$ math block
    let dollarBlockCount = 0;
    for (let i = 0; i <= idx; i++) {
        const matches = lines[i].match(/\$\$/g);
        if (matches) {
            dollarBlockCount += matches.length;
        }
    }

    // If odd number of $$ up to idx, scan forward a few lines for the closing $$
    if (dollarBlockCount % 2 === 1) {
        for (let j = idx + 1; j < Math.min(lines.length, idx + 15); j++) {
            if (lines[j].includes("$$")) {
                idx = j;
                break;
            }
        }
    }

    // Advance past immediately attached block IDs (^blockid) or standalone footnote refs ([^1])
    let scan = idx + 1;
    while (scan < lines.length) {
        const trimmed = lines[scan].trim();
        if (trimmed === "") {
            // Look ahead one line past a single blank line for ^blockid or [^footnote]
            if (scan + 1 < lines.length) {
                const nextTrimmed = lines[scan + 1].trim();
                if (/^\^[a-zA-Z0-9_-]+$/.test(nextTrimmed) || /^(?:\[\^[^\]]+\]\s*)+$/.test(nextTrimmed)) {
                    idx = scan + 1;
                    scan = idx + 1;
                    continue;
                }
            }
            break;
        }
        if (/^\^[a-zA-Z0-9_-]+$/.test(trimmed) || /^(?:\[\^[^\]]+\]\s*)+$/.test(trimmed)) {
            idx = scan;
            scan++;
            continue;
        }
        break;
    }

    return idx;
}

/**
 * Inserts the simulation markdown block into full note text below the target selection
 * or specified line index.
 *
 * @param {string} noteContent - Full markdown content of the note.
 * @param {string} embedBlock - Markdown block to insert ([[file.html]] + dataviewjs).
 * @param {object} [location]
 * @param {number} [location.selectionEndLine] - 0-based line number where selection ended.
 * @param {string} [location.selectedText] - Selected text to locate if selectionEndLine is not given.
 * @returns {string} Updated note markdown content.
 */
function insertSimulationBelowSelection(noteContent, embedBlock, { selectionEndLine, selectedText } = {}) {
    const normalized = (noteContent || "").replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");

    let endLine = typeof selectionEndLine === "number" ? selectionEndLine : -1;

    if (endLine < 0 && selectedText && selectedText.trim()) {
        const cleanSel = selectedText.replace(/\r\n?/g, "\n");
        const charIdx = normalized.indexOf(cleanSel);
        if (charIdx !== -1) {
            const endCharIdx = charIdx + cleanSel.length;
            endLine = normalized.slice(0, endCharIdx).split("\n").length - 1;
        } else {
            // Try matching trimmed single line
            const trimmedSel = cleanSel.trim();
            const lineIdx = lines.findIndex(l => l.includes(trimmedSel));
            if (lineIdx !== -1) {
                endLine = lineIdx;
            }
        }
    }

    if (endLine < 0) {
        endLine = lines.length - 1;
    }

    const insertAfterLine = findInsertionLineIndex(lines, endLine);
    const before = lines.slice(0, insertAfterLine + 1).join("\n");
    const after = lines.slice(insertAfterLine + 1).join("\n");

    const trimmedEmbed = embedBlock.trim();
    if (after.trim().length === 0) {
        return `${before.replace(/\n+$/, "")}\n\n${trimmedEmbed}\n`;
    }
    return `${before.replace(/\n+$/, "")}\n\n${trimmedEmbed}\n\n${after.replace(/^\n+/, "")}`;
}

/**
 * Resolves the Google Gemini API key and configured models from:
 * 1. Explicit options.apiKey
 * 2. Obsidian Copilot plugin settings & app.secretStorage keychain
 * 3. Environment variables (GEMINI_API_KEY / GOOGLE_API_KEY)
 *
 * @param {object} app - Obsidian App instance.
 * @param {object} [options] - Script options.
 * @returns {Promise<{ apiKey: string|null, baseUrl: string, models: string[] }>}
 */
async function resolveGeminiConfig(app, options = {}) {
    let apiKey = options.apiKey || null;
    let baseUrl = "https://generativelanguage.googleapis.com";
    const configuredGeminiModels = [];

    // 1. Inspect Copilot plugin configuration if available
    let copilotData = app?.plugins?.plugins?.["copilot"]?.settings || null;
    if (!copilotData && app?.vault?.adapter?.read) {
        try {
            const rawJson = await app.vault.adapter.read(".obsidian/plugins/copilot/data.json");
            copilotData = JSON.parse(rawJson);
        } catch (_) {
            // Ignore if copilot data.json does not exist
        }
    }

    const keychainIdsToTry = [COPILOT_GOOGLE_KEYCHAIN_ID];

    if (copilotData) {
        if (!apiKey && copilotData.googleApiKey && typeof copilotData.googleApiKey === "string") {
            apiKey = copilotData.googleApiKey.trim();
        }

        const providers = copilotData.providers || {};
        for (const prov of Object.values(providers)) {
            if (!prov) continue;
            const isGoogle =
                prov.providerType === "google" ||
                prov.origin?.catalogProviderId === "google" ||
                (prov.baseUrl && prov.baseUrl.includes("generativelanguage.googleapis.com"));
            if (isGoogle) {
                if (prov.baseUrl) {
                    baseUrl = prov.baseUrl.replace(/\/+$/, "");
                }
                if (prov.apiKeyKeychainId && !keychainIdsToTry.includes(prov.apiKeyKeychainId)) {
                    keychainIdsToTry.unshift(prov.apiKeyKeychainId);
                }
            }
        }

        if (Array.isArray(copilotData.configuredModels)) {
            for (const cm of copilotData.configuredModels) {
                const id = cm?.info?.id;
                if (id && id.startsWith("gemini-") && !id.includes("embedding") && !id.includes("tts") && !id.includes("image")) {
                    configuredGeminiModels.push(id);
                }
            }
        }
    }

    // 2. Read from Obsidian's SecretStorage (Keychain)
    if (!apiKey && app?.secretStorage && typeof app.secretStorage.getSecret === "function") {
        if (typeof app.secretStorage.listSecrets === "function") {
            try {
                const allKeys = await app.secretStorage.listSecrets();
                if (Array.isArray(allKeys)) {
                    for (const k of allKeys) {
                        if (typeof k === "string" && k.toLowerCase().includes("google") && !keychainIdsToTry.includes(k)) {
                            keychainIdsToTry.push(k);
                        }
                    }
                }
            } catch (_) {
                // Ignore listSecrets errors
            }
        }

        for (const keychainId of keychainIdsToTry) {
            try {
                const secret = await app.secretStorage.getSecret(keychainId);
                if (secret && typeof secret === "string" && secret.trim()) {
                    apiKey = secret.trim();
                    break;
                }
            } catch (_) {
                // Ignore and try next keychain ID
            }
        }
    }

    // 3. Check environment variables
    if (!apiKey && typeof process !== "undefined" && process.env) {
        apiKey =
            process.env.GEMINI_API_KEY ||
            process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
            process.env.GOOGLE_API_KEY ||
            null;
    }

    // Build prioritized model list
    const models = [];
    const addModel = (m) => {
        if (m && typeof m === "string" && !models.includes(m)) {
            models.push(m);
        }
    };

    if (options.model) addModel(options.model);
    DEFAULT_GEMINI_MODELS.forEach(addModel);
    configuredGeminiModels.forEach(addModel);

    return { apiKey, baseUrl, models };
}

/**
 * Performs an HTTP POST request using Obsidian's requestUrl (if available) or fetch.
 *
 * @param {string} url - Endpoint URL.
 * @param {object} bodyObj - JSON request payload.
 * @param {object} [tp] - Templater object.
 * @returns {Promise<{ status: number, json: any, text: string }>}
 */
async function postJson(url, bodyObj, tp) {
    const bodyStr = JSON.stringify(bodyObj);
    const requestUrlFn =
        tp?.obsidian?.requestUrl ||
        (typeof window !== "undefined" && window.require ? (() => {
            try { return window.require("obsidian").requestUrl; } catch (_) { return null; }
        })() : null);

    if (typeof requestUrlFn === "function") {
        const response = await requestUrlFn({
            url,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: bodyStr,
            throw: false
        });
        let parsed = null;
        try {
            parsed = response.json || JSON.parse(response.text);
        } catch (_) {
            parsed = null;
        }
        return {
            status: response.status,
            json: parsed,
            text: response.text || ""
        };
    }

    if (typeof fetch === "function") {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: bodyStr
        });
        const text = await res.text();
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (_) {
            parsed = null;
        }
        return {
            status: res.status,
            json: parsed,
            text
        };
    }

    throw new Error("Keine HTTP-Funktion (requestUrl oder fetch) verfügbar.");
}

/**
 * Generates HTML simulation content via Google Gemini REST API.
 * Tries models in priority order until a valid HTML document is returned.
 *
 * @param {string} prompt - Full prompt text.
 * @param {object} geminiConfig - Config from resolveGeminiConfig.
 * @param {object} [tp] - Templater object.
 * @returns {Promise<string>} Extracted HTML document string.
 */
async function generateWithGeminiApi(prompt, geminiConfig, tp) {
    const { apiKey, baseUrl, models } = geminiConfig;
    if (!apiKey) {
        throw new Error("Kein Google Gemini API-Key gefunden.");
    }

    const errors = [];
    for (const model of models) {
        const cleanModel = model.replace(/^google\//, "").replace(/^models\//, "");
        const url = `${baseUrl}/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        try {
            const response = await postJson(
                url,
                {
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: prompt }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 16384
                    }
                },
                tp
            );

            if (response.status >= 200 && response.status < 300 && response.json) {
                const candidates = response.json.candidates || [];
                const parts = candidates[0]?.content?.parts || [];
                const text = parts
                    .map(p => (typeof p.text === "string" ? p.text : ""))
                    .join("\n")
                    .trim();

                const html = extractHtmlDocument(text);
                if (html) {
                    return html;
                }
                errors.push(`${cleanModel}: Antwort enthielt kein gültiges HTML.`);
            } else {
                const errMsg = response.json?.error?.message || `HTTP ${response.status}`;
                errors.push(`${cleanModel}: ${errMsg}`);
                // If the API key itself is invalid/unauthorized (401/403), stop trying other models
                if (response.status === 401 || response.status === 403) {
                    break;
                }
            }
        } catch (err) {
            errors.push(`${cleanModel}: ${err.message || String(err)}`);
        }
    }

    throw new Error(`Gemini API Fehler: ${errors.join(" | ")}`);
}

/**
 * Fallback generator using the locally installed OpenCode CLI (/opt/homebrew/bin/opencode).
 *
 * @param {string} prompt - Full prompt text.
 * @param {object} [geminiConfig] - Optional Gemini config (passes API key in env if present).
 * @returns {Promise<string>} Extracted HTML document string.
 */
async function generateWithOpenCodeCli(prompt, geminiConfig = {}) {
    let childProcess = null;
    try {
        childProcess = typeof window !== "undefined" && window.require
            ? window.require("child_process")
            : require("child_process");
    } catch (_) {
        throw new Error("Node child_process ist für den OpenCode-CLI-Fallback nicht verfügbar.");
    }

    const candidates = [
        "/opt/homebrew/bin/opencode",
        "/usr/local/bin/opencode",
        "opencode"
    ];

    const modelsToTry = [
        "google/gemini-2.5-flash",
        "google/gemini-3.7-flash",
        "opencode/big-pickle"
    ];

    const env = {
        ...(typeof process !== "undefined" && process.env ? process.env : {}),
        PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${(typeof process !== "undefined" && process.env?.PATH) || ""}`
    };

    if (geminiConfig && geminiConfig.apiKey) {
        env.GOOGLE_GENERATIVE_AI_API_KEY = geminiConfig.apiKey;
        env.GEMINI_API_KEY = geminiConfig.apiKey;
    }

    const runCli = (bin, args) =>
        new Promise((resolve, reject) => {
            childProcess.execFile(
                bin,
                args,
                { env, timeout: 90000, maxBuffer: 10 * 1024 * 1024 },
                (err, stdout, stderr) => {
                    if (err && !stdout) {
                        reject(new Error(stderr || err.message));
                        return;
                    }
                    resolve(String(stdout || "") + "\n" + String(stderr || ""));
                }
            );
        });

    const errors = [];
    for (const bin of candidates) {
        for (const model of modelsToTry) {
            try {
                const output = await runCli(bin, ["run", "--pure", "-m", model, prompt]);
                const html = extractHtmlDocument(output);
                if (html) {
                    return html;
                }
                errors.push(`${model}: Kein HTML im CLI-Output gefunden`);
            } catch (err) {
                const msg = err.message || String(err);
                if (msg.includes("ENOENT")) {
                    // Binary not at this path, try next candidate binary
                    break;
                }
                errors.push(`${model}: ${msg}`);
            }
        }
    }

    throw new Error(`OpenCode CLI Fallback fehlgeschlagen: ${errors.join(" | ")}`);
}

/**
 * Ensures all folders along folderPath exist in the Obsidian vault.
 *
 * @param {object} vault - Obsidian Vault instance.
 * @param {string} folderPath - Vault-relative folder path.
 */
async function ensureFolderExists(vault, folderPath) {
    if (!folderPath || folderPath === "/" || !vault) return;
    const normalized = folderPath.replace(/^\/+|\/+$/g, "");
    if (!normalized) return;

    const existing = vault.getAbstractFileByPath(normalized);
    if (existing) return;

    if (typeof vault.createFolder === "function") {
        const parts = normalized.split("/");
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!vault.getAbstractFileByPath(current)) {
                try {
                    await vault.createFolder(current);
                } catch (_) {
                    // Ignore if folder was created concurrently
                }
            }
        }
    }
}

/**
 * Resolves a unique file path in the target folder so existing simulations are not overwritten
 * unless overwrite=true is explicitly requested.
 *
 * @param {object} vault - Obsidian Vault instance.
 * @param {string} folderPath - Target folder path in the vault.
 * @param {string} fileName - Desired file name (e.g. "Simulation - Blindleistung.html").
 * @param {boolean} [overwrite=false] - Whether to overwrite an existing file.
 * @returns {{ fileName: string, fullPath: string }}
 */
function resolveUniqueHtmlPath(vault, folderPath, fileName, overwrite = false) {
    const cleanFolder = (folderPath || "").replace(/^\/+|\/+$/g, "");
    const baseName = fileName.replace(/\.html?$/i, "");
    let candidateName = `${baseName}.html`;
    let fullPath = cleanFolder ? `${cleanFolder}/${candidateName}` : candidateName;

    if (overwrite || !vault || typeof vault.getAbstractFileByPath !== "function") {
        return { fileName: candidateName, fullPath };
    }

    let counter = 2;
    while (vault.getAbstractFileByPath(fullPath)) {
        candidateName = `${baseName} ${counter}.html`;
        fullPath = cleanFolder ? `${cleanFolder}/${candidateName}` : candidateName;
        counter++;
    }

    return { fileName: candidateName, fullPath };
}

/**
 * Main Templater User Script entry point.
 *
 * @param {object} tp - Templater object passed by Obsidian Templater.
 * @param {object} [options={}] - Optional configuration overrides.
 * @returns {Promise<object>} Result object whose toString() returns "" to prevent unintended text insertion by Templater.
 */
function createSimulationFromSelection(tp, options = {}) {
    const promise = (async () => {
        const app = tp?.app || (typeof window !== "undefined" ? window.app : null);
        if (!app || !app.vault) {
            throw new Error("Obsidian App/Vault nicht verfügbar.");
        }

        const notify = (msg, duration = 5000) => {
            if (options.silent) return;
            if (typeof Notice !== "undefined") {
                new Notice(msg, duration);
            } else {
                console.log(`[Notice] ${msg}`);
            }
        };

        // 1. Identify active editor and target file
        const activeEditor = app.workspace?.activeEditor?.editor || null;
        let targetFile = null;
        if (options.targetFile) {
            targetFile = typeof options.targetFile === "string"
                ? app.vault.getAbstractFileByPath(options.targetFile)
                : options.targetFile;
        } else if (tp?.config?.target_file) {
            targetFile = tp.config.target_file;
        } else if (app.workspace?.getActiveFile) {
            targetFile = app.workspace.getActiveFile();
        }

        if (!targetFile) {
            notify("❌ Keine aktive Notiz gefunden!");
            return "";
        }

        // 2. Capture selection and IMMEDIATELY collapse editor selection so Templater
        // does not overwrite the selected formula/text with "" when the template completes.
        let selectedText = "";
        let selectionEndLine = -1;

        if (typeof options.selection === "string" && options.selection.trim()) {
            selectedText = options.selection;
            if (typeof options.selectionEndLine === "number") {
                selectionEndLine = options.selectionEndLine;
            }
        } else if (activeEditor && typeof activeEditor.getSelection === "function") {
            selectedText = activeEditor.getSelection() || "";
            const toPos = typeof activeEditor.getCursor === "function"
                ? activeEditor.getCursor("to")
                : null;
            if (toPos && typeof toPos.line === "number") {
                selectionEndLine = toPos.line;
                if (typeof activeEditor.setCursor === "function") {
                    activeEditor.setCursor(toPos);
                }
            }
        } else if (tp?.file?.selection) {
            try {
                selectedText = tp.file.selection() || "";
            } catch (_) {
                selectedText = "";
            }
        }

        // If no text was selected, check current line or prompt the user
        if (!selectedText || !selectedText.trim()) {
            let defaultLineText = "";
            if (activeEditor && typeof activeEditor.getCursor === "function" && typeof activeEditor.getLine === "function") {
                const cursor = activeEditor.getCursor();
                if (cursor && typeof cursor.line === "number") {
                    selectionEndLine = cursor.line;
                    defaultLineText = (activeEditor.getLine(cursor.line) || "").trim();
                }
            }

            if (tp?.system?.prompt && !options.skipPrompt) {
                const prompted = await tp.system.prompt(
                    "Kein Text markiert. Bitte Formel oder Text für die Simulation eingeben:",
                    defaultLineText || "",
                    false,
                    true
                );
                if (prompted === null || prompted === undefined || !String(prompted).trim()) {
                    notify("ℹ️ Abgebrochen: Kein Text für die Simulation ausgewählt.");
                    return "";
                }
                selectedText = String(prompted).trim();
            } else if (defaultLineText) {
                selectedText = defaultLineText;
            } else {
                notify("⚠️ Bitte markiere zuerst einen Text oder eine Formel in der Notiz.");
                return "";
            }
        }

        // 3. Read note content to gather surrounding context
        const noteContent = activeEditor && typeof activeEditor.getValue === "function"
            ? activeEditor.getValue()
            : await app.vault.read(targetFile);
        const noteLines = (noteContent || "").replace(/\r\n?/g, "\n").split("\n");

        if (selectionEndLine < 0) {
            const cleanSel = selectedText.replace(/\r\n?/g, "\n");
            const idx = noteContent.indexOf(cleanSel);
            if (idx !== -1) {
                selectionEndLine = noteContent.slice(0, idx + cleanSel.length).split(/\r?\n/).length - 1;
            } else {
                selectionEndLine = noteLines.length - 1;
            }
        }

        const contextStart = Math.max(0, selectionEndLine - 15);
        const contextEnd = Math.min(noteLines.length, selectionEndLine + 8);
        const surroundingContext = noteLines.slice(contextStart, contextEnd).join("\n");

        const prompt = buildSimulationPrompt({
            selection: selectedText,
            noteTitle: targetFile.basename || "",
            surroundingContext,
            customInstructions: options.customInstructions || ""
        });

        notify("⏳ Erstelle interaktive Simulation/Visualisierung...", 8000);

        // 4. Generate HTML via customGenerator (for tests), Gemini API, or OpenCode CLI fallback
        let htmlContent = "";
        if (typeof options.customGenerator === "function") {
            const raw = await options.customGenerator(prompt, {
                selection: selectedText,
                noteTitle: targetFile.basename || "",
                surroundingContext
            });
            htmlContent = extractHtmlDocument(raw);
        } else {
            const geminiConfig = await resolveGeminiConfig(app, options);
            let lastError = null;

            if (geminiConfig.apiKey) {
                try {
                    htmlContent = await generateWithGeminiApi(prompt, geminiConfig, tp);
                } catch (err) {
                    lastError = err;
                    console.warn("[createSimulationFromSelection] Gemini API failed, trying OpenCode CLI fallback:", err);
                }
            }

            if (!htmlContent) {
                try {
                    htmlContent = await generateWithOpenCodeCli(prompt, geminiConfig);
                } catch (cliErr) {
                    const combinedMsg = lastError
                        ? `${lastError.message} | ${cliErr.message}`
                        : cliErr.message;
                    notify(`❌ Fehler bei der Simulations-Generierung: ${combinedMsg}`, 8000);
                    throw new Error(combinedMsg);
                }
            }
        }

        if (!htmlContent) {
            notify("❌ Es konnte kein gültiger HTML-Code für die Simulation generiert werden.");
            return "";
        }

        // 5. Save HTML file into "2 - Source Material/Animations"
        const outputFolder = options.outputFolder || DEFAULT_OUTPUT_FOLDER;
        await ensureFolderExists(app.vault, outputFolder);

        const desiredName = deriveSimulationFileName({
            explicitFileName: options.fileName,
            htmlContent,
            selection: selectedText,
            noteTitle: targetFile.basename || ""
        });

        const { fileName: finalFileName, fullPath: htmlFilePath } = resolveUniqueHtmlPath(
            app.vault,
            outputFolder,
            desiredName,
            Boolean(options.overwrite)
        );

        const existingHtmlFile = app.vault.getAbstractFileByPath(htmlFilePath);
        if (existingHtmlFile) {
            await app.vault.modify(existingHtmlFile, htmlContent);
        } else {
            await app.vault.create(htmlFilePath, htmlContent);
        }

        // 6. Build dataviewjs live renderer and insert below selection
        const embedBlock = buildSimulationEmbedBlock(finalFileName, htmlFilePath);

        // Re-read current content in case user scrolled/typed while waiting
        const currentContent = activeEditor && typeof activeEditor.getValue === "function"
            ? activeEditor.getValue()
            : await app.vault.read(targetFile);

        const updatedContent = insertSimulationBelowSelection(currentContent, embedBlock, {
            selectionEndLine,
            selectedText
        });

        if (
            activeEditor &&
            typeof activeEditor.replaceRange === "function" &&
            typeof activeEditor.getLine === "function"
        ) {
            const currentLines = currentContent.replace(/\r\n?/g, "\n").split("\n");
            const insertAfterLine = findInsertionLineIndex(currentLines, selectionEndLine);
            const targetLineText = activeEditor.getLine(insertAfterLine) ?? "";
            const insertPos = { line: insertAfterLine, ch: targetLineText.length };
            activeEditor.replaceRange(`\n\n${embedBlock.trim()}\n`, insertPos, insertPos);
            if (typeof activeEditor.setCursor === "function") {
                activeEditor.setCursor(insertPos);
            }
        } else if (activeEditor && typeof activeEditor.setValue === "function") {
            const scrollInfo = typeof activeEditor.getScrollInfo === "function"
                ? activeEditor.getScrollInfo()
                : null;
            activeEditor.setValue(updatedContent);
            if (scrollInfo && typeof activeEditor.scrollTo === "function") {
                activeEditor.scrollTo(scrollInfo.left, scrollInfo.top);
            }
        } else {
            await app.vault.modify(targetFile, updatedContent);
        }

        notify(`✅ Simulation erstellt und eingefügt: ${finalFileName}`, 6000);

        const result = {
            htmlFilePath,
            fileName: finalFileName,
            embedBlock,
            updatedContent,
            toString() {
                return "";
            },
            valueOf() {
                return "";
            },
            [Symbol.toPrimitive]() {
                return "";
            },
            toJSON() {
                return "";
            }
        };

        return result;
    })();

    promise.toString = () => "";
    promise.valueOf = () => "";
    if (typeof Symbol !== "undefined" && Symbol.toPrimitive) {
        promise[Symbol.toPrimitive] = () => "";
    }

    return promise;
}

module.exports = createSimulationFromSelection;
module.exports.stripTimestampPrefix = stripTimestampPrefix;
module.exports.sanitizeFileName = sanitizeFileName;
module.exports.deriveSimulationFileName = deriveSimulationFileName;
module.exports.injectAutoResizeScript = injectAutoResizeScript;
module.exports.extractHtmlDocument = extractHtmlDocument;
module.exports.buildSimulationPrompt = buildSimulationPrompt;
module.exports.buildSimulationEmbedBlock = buildSimulationEmbedBlock;
module.exports.findInsertionLineIndex = findInsertionLineIndex;
module.exports.insertSimulationBelowSelection = insertSimulationBelowSelection;
module.exports.resolveGeminiConfig = resolveGeminiConfig;
module.exports.resolveUniqueHtmlPath = resolveUniqueHtmlPath;
