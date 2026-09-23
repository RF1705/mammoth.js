var assert = require("assert");

var documents = require("../lib/documents");
var DocumentConverter = require("../lib/document-to-html").DocumentConverter;
var htmlPaths = require("../lib/styles/html-paths");
var documentMatchers = require("../lib/styles/document-matchers");
var readNumberingProperties = require("../lib/docx/body-reader")._readNumberingProperties;
var XmlElement = require("../lib/xml").Element;
var test = require("./test")(module);


function heading(text, styleName, level, levels) {
    return new documents.Paragraph(
        [new documents.Run([new documents.Text(text)])],
        {
            styleName: styleName,
            numbering: {
                isOrdered: true,
                level: String(level),
                numId: "9",
                levels: levels,
                numFmt: levels[level].numFmt,
                levelText: levels[level].levelText,
                start: levels[level].start
            }
        }
    );
}


test("preserveHeadingNumbering materialises multilevel Word heading labels", function() {
    var levels = {
        "0": {numFmt: "upperRoman", levelText: "%1.", start: "1"},
        "1": {numFmt: "decimal", levelText: "%2.", start: "1"},
        "2": {numFmt: "decimal", levelText: "%2.%3.", start: "1"}
    };

    var document = new documents.Document([
        heading("Entscheidender Teil", "Heading 1", 0, levels),
        heading("Anordnung der Änderung des Verfahrensgebietes", "Heading 1", 1, levels),
        heading("Anordnung der Änderung", "Heading 2", 2, levels),
        heading("Änderung des Verfahrensgebietes", "Heading 2", 2, levels),
        heading("Weitere Anordnung", "Heading 1", 1, levels),
        heading("Zweiter Teil", "Heading 1", 0, levels)
    ]);

    var converter = new DocumentConverter({
        styleMap: [
            {
                from: documentMatchers.paragraph({
                    styleName: documentMatchers.equalTo("Heading 1")
                }),
                to: htmlPaths.topLevelElement("h1")
            },
            {
                from: documentMatchers.paragraph({
                    styleName: documentMatchers.equalTo("Heading 2")
                }),
                to: htmlPaths.topLevelElement("h2")
            }
        ],
        preserveHeadingNumbering: true
    });

    return converter.convertToHtml(document).then(function(result) {
        assert.equal(
            result.value,
            "<h1>I. Entscheidender Teil</h1>" +
            "<h1>1. Anordnung der Änderung des Verfahrensgebietes</h1>" +
            "<h2>1.1. Anordnung der Änderung</h2>" +
            "<h2>1.2. Änderung des Verfahrensgebietes</h2>" +
            "<h1>2. Weitere Anordnung</h1>" +
            "<h1>II. Zweiter Teil</h1>"
        );
    });
});


test("heading numbering is disabled by default", function() {
    var levels = {
        "0": {numFmt: "upperRoman", levelText: "%1.", start: "1"}
    };

    var document = new documents.Document([
        heading("Entscheidender Teil", "Heading 1", 0, levels)
    ]);

    var converter = new DocumentConverter({
        styleMap: [
            {
                from: documentMatchers.paragraph({
                    styleName: documentMatchers.equalTo("Heading 1")
                }),
                to: htmlPaths.topLevelElement("h1")
            }
        ]
    });

    return converter.convertToHtml(document).then(function(result) {
        assert.equal(result.value, "<h1>Entscheidender Teil</h1>");
    });
});


test("explicit Word numbering keeps numId and all levels", function() {
    var levels = {
        "0": {isOrdered: true, level: "0", numFmt: "upperRoman", levelText: "%1.", start: "1"},
        "1": {isOrdered: true, level: "1", numFmt: "decimal", levelText: "%2.", start: "1"}
    };

    var numbering = {
        findLevel: function(numId, level) {
            assert.equal(numId, "9");
            return levels[level];
        },
        findLevels: function(numId) {
            assert.equal(numId, "9");
            return levels;
        },
        findLevelByParagraphStyleId: function() {
            return null;
        }
    };

    var numPr = new XmlElement("w:numPr", {}, [
        new XmlElement("w:ilvl", {"w:val": "1"}),
        new XmlElement("w:numId", {"w:val": "9"})
    ]);

    var properties = readNumberingProperties("Heading1", numPr, numbering);

    assert.equal(properties.numId, "9");
    assert.strictEqual(properties.levels, levels);
    assert.equal(properties.levelText, "%2.");
});
