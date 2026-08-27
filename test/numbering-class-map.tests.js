var assert = require("assert");
var duck = require("duck");

var documents = require("../lib/documents");
var DocumentConverter = require("../lib/document-to-html").DocumentConverter;
var htmlPaths = require("../lib/styles/html-paths");
var documentMatchers = require("../lib/styles/document-matchers");
var readNumberingXml = require("../lib/docx/numbering-xml").readNumberingXml;
var stylesReader = require("../lib/docx/styles-reader");
var XmlElement = require("../lib/xml").Element;
var test = require("./test")(module);


test("numbering metadata preserves numFmt and levelText", function() {
    var numbering = readNumberingXml(
        new XmlElement("w:numbering", {}, [
            new XmlElement("w:abstractNum", {"w:abstractNumId": "42"}, [
                new XmlElement("w:lvl", {"w:ilvl": "1"}, [
                    new XmlElement("w:numFmt", {"w:val": "decimal"}),
                    new XmlElement("w:lvlText", {"w:val": "%1.%2"})
                ])
            ]),
            new XmlElement("w:num", {"w:numId": "47"}, [
                new XmlElement("w:abstractNumId", {"w:val": "42"})
            ])
        ]),
        {styles: stylesReader.defaultStyles}
    );

    duck.assertThat(numbering.findLevel("47", "1"), duck.hasProperties({
        isOrdered: true,
        level: "1",
        numFmt: "decimal",
        levelText: "%1.%2"
    }));
});


test("numberingClassMap applies a class to the matching list level", function() {
    var paragraph = new documents.Paragraph(
        [new documents.Run([new documents.Text("Nested item")])],
        {
            numbering: {
                isOrdered: true,
                level: "1",
                numFmt: "decimal",
                levelText: "%1.%2"
            }
        }
    );

    var converter = new DocumentConverter({
        styleMap: [
            {
                from: documentMatchers.paragraph({
                    list: {isOrdered: true, levelIndex: 1}
                }),
                to: htmlPaths.elements([
                    htmlPaths.element(["ul", "ol"]),
                    htmlPaths.element("li"),
                    htmlPaths.element("ol"),
                    htmlPaths.element("li", {}, {fresh: true})
                ])
            }
        ],
        numberingClassMap: [
            {
                numFmt: "decimal",
                levelText: "%1.%2",
                className: "legal-list"
            }
        ]
    });

    return converter.convertToHtml(paragraph).then(function(result) {
        assert.equal(
            result.value,
            '<ul><li><ol class="legal-list"><li>Nested item</li></ol></li></ul>'
        );
    });
});


test("numberingClassMap distinguishes levelText variants", function() {
    var paragraph = new documents.Paragraph(
        [new documents.Run([new documents.Text("Nested item")])],
        {
            numbering: {
                isOrdered: true,
                level: "1",
                numFmt: "decimal",
                levelText: "%1.%2."
            }
        }
    );

    var converter = new DocumentConverter({
        styleMap: [
            {
                from: documentMatchers.paragraph({
                    list: {isOrdered: true, levelIndex: 1}
                }),
                to: htmlPaths.elements([
                    htmlPaths.element(["ul", "ol"]),
                    htmlPaths.element("li"),
                    htmlPaths.element("ol"),
                    htmlPaths.element("li", {}, {fresh: true})
                ])
            }
        ],
        numberingClassMap: [
            {
                numFmt: "decimal",
                levelText: "%1.%2",
                className: "legal-list"
            }
        ]
    });

    return converter.convertToHtml(paragraph).then(function(result) {
        assert.equal(
            result.value,
            "<ul><li><ol><li>Nested item</li></ol></li></ul>"
        );
    });
});


test("numberingClassMap can match numFmt without levelText", function() {
    var paragraph = new documents.Paragraph(
        [new documents.Run([new documents.Text("Letter item")])],
        {
            numbering: {
                isOrdered: true,
                level: "1",
                numFmt: "lowerLetter",
                levelText: "%2)"
            }
        }
    );

    var converter = new DocumentConverter({
        styleMap: [
            {
                from: documentMatchers.paragraph({
                    list: {isOrdered: true, levelIndex: 1}
                }),
                to: htmlPaths.elements([
                    htmlPaths.element(["ul", "ol"]),
                    htmlPaths.element("li"),
                    htmlPaths.element("ol"),
                    htmlPaths.element("li", {}, {fresh: true})
                ])
            }
        ],
        numberingClassMap: [
            {
                numFmt: "lowerLetter",
                className: "alpha-list"
            }
        ]
    });

    return converter.convertToHtml(paragraph).then(function(result) {
        assert.equal(
            result.value,
            '<ul><li><ol class="alpha-list"><li>Letter item</li></ol></li></ul>'
        );
    });
});
