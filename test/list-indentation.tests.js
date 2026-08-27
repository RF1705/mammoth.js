var assert = require("assert");

var documents = require("../lib/documents");
var DocumentConverter = require("../lib/document-to-html").DocumentConverter;
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

function converter(extraOptions) {
    var options = readOptions(extraOptions || {});
    var styleMapResult = parseStyleMap(options.readStyleMap());
    return new DocumentConverter({
        styleMap: styleMapResult.value,
        inferListNestingFromIndentation: options.inferListNestingFromIndentation,
        numberingClassMap: options.numberingClassMap
    });
}

function paragraph(text, numbering, indent) {
    return new documents.Paragraph([
        new documents.Run([new documents.Text(text)])
    ], {
        numbering: numbering,
        indent: indent
    });
}


test('list indentation can infer nesting when Word stores every list as level zero', function() {
    var parent = {
        isOrdered: true,
        level: "0",
        numId: "5",
        numFmt: "decimal",
        levelText: "(%1)",
        indent: {start: "360"}
    };
    var bulletA = {
        isOrdered: false,
        level: "0",
        numId: "6",
        numFmt: "bullet",
        indent: {start: "1778"}
    };
    var alpha = {
        isOrdered: true,
        level: "0",
        numId: "7",
        numFmt: "lowerLetter",
        levelText: "%1.",
        indent: {start: "1440"}
    };
    var bulletB = {
        isOrdered: false,
        level: "0",
        numId: "8",
        numFmt: "bullet",
        indent: {start: "720"}
    };

    var document = new documents.Document([
        paragraph("Parent 1", parent),
        paragraph("Bullet 1", bulletA, {start: "1058"}),
        paragraph("Bullet 2", bulletA, {start: "1058"}),
        paragraph("Alpha a", alpha),
        paragraph("Alpha b", alpha),
        paragraph("Bullet 3", bulletB, {start: "1058"}),
        paragraph("Parent 2", parent)
    ]);

    return converter({inferListNestingFromIndentation: true})
        .convertToHtml(document)
        .then(function(result) {
            assert.equal(result.value,
                "<ol><li>Parent 1" +
                "<ul><li>Bullet 1</li><li>Bullet 2" +
                "<ol><li>Alpha a</li><li>Alpha b</li></ol>" +
                "</li><li>Bullet 3</li></ul>" +
                "</li><li>Parent 2</li></ol>");
        });
});


test('paragraph indentation overrides numbering definition indentation', function() {
    var parent = {
        isOrdered: true,
        level: "0",
        numId: "5",
        indent: {start: "360"}
    };
    var bullet = {
        isOrdered: false,
        level: "0",
        numId: "6",
        indent: {start: "200"}
    };

    var document = new documents.Document([
        paragraph("Parent", parent),
        paragraph("Bullet", bullet, {start: "1058"})
    ]);

    return converter({inferListNestingFromIndentation: true})
        .convertToHtml(document)
        .then(function(result) {
            assert.equal(result.value,
                "<ol><li>Parent<ul><li>Bullet</li></ul></li></ol>");
        });
});


test('indentation nesting inference is disabled by default', function() {
    var ordered = {
        isOrdered: true,
        level: "0",
        numId: "1",
        indent: {start: "360"}
    };
    var bullet = {
        isOrdered: false,
        level: "0",
        numId: "2",
        indent: {start: "1058"}
    };

    var document = new documents.Document([
        paragraph("Ordered", ordered),
        paragraph("Bullet", bullet)
    ]);

    return converter({})
        .convertToHtml(document)
        .then(function(result) {
            assert.equal(result.value,
                "<ol><li>Ordered</li></ol><ul><li>Bullet</li></ul>");
        });
});
