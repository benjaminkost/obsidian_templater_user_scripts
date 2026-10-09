module.exports = async function (tp) {
// 1. CONFIGURATION: Where are your templates located by default?
const templateFolder = "5 - Templates and Scripts/Template Notes";

// 2. Find all templates in the folder (incl. subfolders)
const templateFiles = app.vault.getMarkdownFiles()
    .filter(f => f.path.startsWith(templateFolder + "/"));

if (templateFiles.length === 0) {
    new Notice(`❌ Keine Templates in '${templateFolder}' gefunden!`);
    return;
}

console.log("Here");

// Display names relative to the template folder (includes subfolders)
const displayNames = templateFiles.map(f =>
    f.path.slice(templateFolder.length + 1).replace(/\.md$/, "")
);

// 3. FIRST PROMPT: selection via suggester
const templateFile = await tp.system.suggester(displayNames, templateFiles, false, "Welches Template möchtest du nutzen?");

// 4. SECOND PROMPT: choose the parent topic the created notes are assigned to
const allNotes = app.vault.getMarkdownFiles();
const displayAllNotes = allNotes.map(f => f.basename);

const upTopic = await tp.system.suggester(displayAllNotes, allNotes, false, "Welchem Oberthema sollen die erstellten Notes zugeordnet werden sollen");

if (templateFile) {
    const templateName = templateFile.basename;

    // Read the template content
    const templateContent = await app.vault.read(templateFile);

    // 5. THIRD PROMPT: the list of names for the new notes
    const input = await tp.system.prompt(`Template '${templateName}' geladen. Gib jetzt die neuen Notiz-Namen ein:`);

    if (input) {
        // Split by line break
        const cleanInput = input.replaceAll(String.fromCharCode(10), ",");
        const names = cleanInput.split(",").map(name => name.trim()).filter(name => name.length > 0);

        const timestamp = tp.date.now("YYYYMMDDHHmm");
        const currentDate = tp.date.now("DD.MM.YYYY HH:mm");

        // Trick: we build the search strings from separate parts,
        // so the Templater parser does not mistake the closing tag in the code for the end of the block!
        const startTag = "<" + "%";
        const endTag = "%" + ">";

        const searchTitle1 = startTag + " tp.file.title " + endTag;
        const searchTitle2 = startTag + "tp.file.title" + endTag;
        const searchDate1 = startTag + ' tp.date.now("DD.MM.YYYY HH:mm") ' + endTag;
        const searchDate2 = startTag + 'tp.date.now("DD.MM.YYYY HH:mm")' + endTag;
        const searchDate3 = startTag + " tp.date.now('DD.MM.YYYY HH:mm') " + endTag;
        const searchDate4 = startTag + "tp.date.now('DD.MM.YYYY HH:mm')" + endTag;

        // 6. Loop for creating the notes
        for (const name of names) {
            const fileName = `${timestamp} - ${name}`;
            let finalContent = templateContent;

            // Text replacement using the split strings
            finalContent = finalContent.replaceAll(searchTitle1, fileName);
            finalContent = finalContent.replaceAll(searchTitle2, fileName);
            finalContent = finalContent.replaceAll(searchDate1, currentDate);
            finalContent = finalContent.replaceAll(searchDate2, currentDate);
            finalContent = finalContent.replaceAll(searchDate3, currentDate);
            finalContent = finalContent.replaceAll(searchDate4, currentDate);

			const aliasOfNote = upTopic.basename.split(" - ").at(-1) ?  "|"+ upTopic.basename.split(" - ").at(-1) : "";
	        const noteNameWithAlias = upTopic.basename + aliasOfNote;
            finalContent = finalContent.replaceAll("up: ", `up: \n- "[[${noteNameWithAlias}]]"`);

            try {
                await app.vault.create(`${fileName}.md`, finalContent);
            } catch (error) {
                console.error(`Fehler beim Erstellen von ${fileName}:`, error);
            }
        }

        new Notice(`${names.length} Notizen basierend auf '${templateName}' erstellt!`);
    } else {
        new Notice("Abgebrochen: Keine Namen eingegeben.");
    }
} else {
    new Notice("Abgebrochen: Kein Template ausgewählt.");
}
};
