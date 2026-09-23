var assert = require("assert");

var documents = require("../lib/documents");
var DocumentConverter = require("../lib/document-to-html").DocumentConverter;
var nonListNumbering = require("../lib/non-list-numbering");
var readOptions = require("../lib/options-reader").readOptions;
var readStyle = require("../lib/style-reader").readStyle;
var Result = require("../lib/results").Result;
var test = require("./test")(module);


function parseStyleMap(styleMap) {
    return Result.combine((styleMap || []).map(readStyle))
        .map(function(styleMap) {
            return styleMap.filter(function(styleMapping) {
                return !!styleMapping;
            });
        });
}

function paragraph(text, properties) {
    return new documents.Paragraph([
        new documents.Run([new documents.Text(text)])
    ], properties);
}


test("numbered non-list headings do not seed inferred list nesting", function() {
    var options = readOptions({
        inferListNestingFromIndentation: true,
        numberingClassMap: [{
            numFmt: "decimal",
            levelText: "(%1)",
            className: "parenthesized-list"
        }]
    });
    var styleMapResult = parseStyleMap(options.readStyleMap());

    var headingNumbering = {
        isOrdered: false,
        level: "1",
        numId: "25",
        numFmt: "bullet",
        indent: {start: "426"}
    };
    var listNumbering = {
        isOrdered: true,
        level: "0",
        numId: "17",
        numFmt: "decimal",
        levelText: "(%1)",
        indent: {start: "426"}
    };

    var document = new documents.Document([
        paragraph("General rules", {
            styleId: "Heading3",
            styleName: "Heading 3",
            numbering: headingNumbering,
            indent: {start: "426"}
        }),
        paragraph("First", {
            numbering: listNumbering,
            indent: {start: "426"}
        }),
        paragraph("Second", {
            numbering: listNumbering,
            indent: {start: "426"}
        })
    ]);

    var normalisedDocument = nonListNumbering.normalise(
        document,
        styleMapResult.value
    );
    var converter = new DocumentConverter({
        styleMap: styleMapResult.value,
        inferListNestingFromIndentation: true,
        numberingClassMap: options.numberingClassMap
    });

    assert.equal(normalisedDocument.children[0].numbering, null);
    assert.equal(normalisedDocument.children[1].numbering, listNumbering);

    return converter.convertToHtml(normalisedDocument).then(function(result) {
        assert.equal(result.value,
            '<h3>General rules</h3>' +
            '<ol class="parenthesized-list">' +
            '<li>First</li><li>Second</li></ol>');
    });
});
