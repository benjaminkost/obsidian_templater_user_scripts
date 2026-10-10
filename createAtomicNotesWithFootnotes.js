/**
 * Templater User Script: createAtomicNotesWithFootnotes
 *
 * Uses the logic of createAtomicNotes.js (splits the open note into atomic notes based on
 * its headings) and additionally converts every wikilink to a PDF into a footnote:
 *   - at the position of the link:  [^1]
 *   - at the end of the note:       [^1]: [[file.pdf]]
 *
 * Details:
 *   - Numbering starts at 1 in every note (or after the highest existing footnote number).
 *   - The same PDF link used several times gets the same footnote number.
 *   - The link target is copied 1:1 (incl. #page=... and |alias).
 *   - Embeds (![[file.pdf]]) and links inside code blocks are left untouched.
 *
 * Usage:
 *   <%* await tp.user.createAtomicNotesWithFootnotes(tp) -%>
 *
 * Options are passed on to createAtomicNotes (templateFile, targetFolder, sourceFile, ...).
 */

// Matches [[...something.pdf...]] but not embeds (![[...]]); group 1 = full link content
const PDF_LINK_REGEX = /(?<!!)\[\[([^\]|#\n]*?\.pdf(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?)\]\]/gi;

function convertPdfLinksToFootnotes(body) {
    // First normalize any raw "file.pdf > page=10" links into "[[file.pdf#page=10]]"
    const normalizedBody = body
        .replace(/\[\[([^\]\r\n]+\.pdf)\]\]\s*>\s*page\s*=\s*(\d+)/gi, "[[$1#page=$2]]")
        .replace(/(?<!\[\[)([^\s\[\]\(\)<>"'#|*?:]+\.pdf)\s*>\s*page\s*=\s*(\d+)(?!\]\])/gi, "[[$1#page=$2]]");

    // Continue after the highest existing footnote number to avoid collisions
    let counter = 0;
    for (const m of body.matchAll(/\[\^(\d+)\]/g)) {
        counter = Math.max(counter, Number(m[1]));
    }

    const numberByLink = new Map();
    const definitions = [];
    let inFence = false;

    const lines = normalizedBody.split("\n").map(line => {
        // Do not touch code blocks
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        return line.replace(PDF_LINK_REGEX, (match, link) => {
            if (!numberByLink.has(link)) {
                counter++;
                numberByLink.set(link, counter);
                definitions.push(`[^${counter}]: [[${link}]]`);
            }
            return `[^${numberByLink.get(link)}]`;
        });
    });

    return {
        text: lines.join("\n"),
        footer: definitions.length > 0 ? definitions.join("\n") + "\n" : ""
    };
}

module.exports = async function (tp, options = {}) {
    if (typeof tp.user?.createAtomicNotes !== "function") {
        new Notice("❌ tp.user.createAtomicNotes wurde nicht gefunden (createAtomicNotes.js im User-Scripts-Ordner?).");
        return;
    }

    return await tp.user.createAtomicNotes(tp, {
        ...options,
        transformBody: convertPdfLinksToFootnotes
    });
};
