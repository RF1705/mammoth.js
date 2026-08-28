var assert = require("assert");

var documents = require("../lib/documents");
var documentToHtml = require("../lib/document-to-html");
var readOptions = require("../lib/options-reader").readOptions;
var readStyle = require("../lib/style-reader").readStyle;
var Result = require("../lib/results").Result;
var test = require("./test")(module);

function run(text) {
    return new documents.Run([new documents.Text(text)]);
}

function paragraph(text, numbering) {
    return new documents.Paragraph([run(text)], {numbering: numbering});
}

function converter() {
    var options = readOptions({});
    var styleMap = Result.combine(options.readStyleMap().map(readStyle)).value.filter(function(mapping) {
        return !!mapping;
    });
    return new documentToHtml.DocumentConverter({styleMap: styleMap});
}

test('ordered list resumes after a normal paragraph with the next number', function() {
    var root = {isOrdered: true, level: "0", numId: "1"};
    var document = new documents.Document([
        paragraph("One", root),
        paragraph("Two", root),
        paragraph("Three", root),
        new documents.Paragraph([run("Interruption")]),
        paragraph("Four", root)
    ]);

    return converter().convertToHtml(document).then(function(result) {
        assert.equal(result.value,
            '<ol><li>One</li><li>Two</li><li>Three</li></ol>' +
            '<p>Interruption</p><ol start="4"><li>Four</li></ol>');
    });
});

test('nested list re-entry does not create continuation start attributes', function() {
    var root = {isOrdered: true, level: "0", numId: "1"};
    var nested = {isOrdered: true, level: "1", numId: "1"};
    var document = new documents.Document([
        paragraph("Parent 1", root),
        paragraph("Child 1.1", nested),
        paragraph("Parent 2", root),
        paragraph("Child 2.1", nested)
    ]);

    return converter().convertToHtml(document).then(function(result) {
        assert.equal(result.value.indexOf('start='), -1);
    });
});
