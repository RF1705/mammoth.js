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
        preserveAlignment: options.preserveAlignment
    });
}

function paragraph(text, alignment) {
    return new documents.Paragraph([
        new documents.Run([new documents.Text(text)])
    ], {alignment: alignment});
}

test('paragraph alignment is not emitted by default', function() {
    return converter({}).convertToHtml(paragraph("Right", "right")).then(function(result) {
        assert.equal(result.value, "<p>Right</p>");
    });
});

test('right paragraph alignment can be preserved', function() {
    return converter({preserveAlignment: true}).convertToHtml(paragraph("Right", "right")).then(function(result) {
        assert.equal(result.value, '<p style="text-align: right">Right</p>');
    });
});

test('center paragraph alignment can be preserved', function() {
    return converter({preserveAlignment: true}).convertToHtml(paragraph("Center", "center")).then(function(result) {
        assert.equal(result.value, '<p style="text-align: center">Center</p>');
    });
});

test('Word both alignment maps to CSS justify', function() {
    return converter({preserveAlignment: true}).convertToHtml(paragraph("Justified", "both")).then(function(result) {
        assert.equal(result.value, '<p style="text-align: justify">Justified</p>');
    });
});


test('Word start alignment maps to CSS left', function() {
    return converter({preserveAlignment: true}).convertToHtml(paragraph("Start", "start")).then(function(result) {
        assert.equal(result.value, '<p style="text-align: left">Start</p>');
    });
});


test('Word end alignment maps to CSS right', function() {
    return converter({preserveAlignment: true}).convertToHtml(paragraph("End", "end")).then(function(result) {
        assert.equal(result.value, '<p style="text-align: right">End</p>');
    });
});
