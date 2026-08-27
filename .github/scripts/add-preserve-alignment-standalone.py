from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit("Could not find expected text in %s" % path)
    path.write_text(text.replace(old, new, 1))

# options-reader.js
path = Path("lib/options-reader.js")
replace_once(
    path,
    '    includeEmbeddedStyleMap: true\n',
    '    includeEmbeddedStyleMap: true,\n    preserveAlignment: false\n',
)

# index.d.ts
path = Path("lib/index.d.ts")
replace_once(
    path,
    '    transformDocument?: (element: any) => any;\n',
    '    transformDocument?: (element: any) => any;\n    preserveAlignment?: boolean;\n',
)

# document-to-html.js
path = Path("lib/document-to-html.js")
text = path.read_text()
text = text.replace(
    'options = _.extend({ignoreEmptyParagraphs: true}, options);',
    'options = _.extend({ignoreEmptyParagraphs: true, preserveAlignment: false}, options);',
    1,
)
if 'var preserveAlignment = !!options.preserveAlignment;' not in text:
    text = text.replace(
        '    var ignoreEmptyParagraphs = options.ignoreEmptyParagraphs;\n',
        '    var ignoreEmptyParagraphs = options.ignoreEmptyParagraphs;\n    var preserveAlignment = !!options.preserveAlignment;\n',
        1,
    )

old = '''    function convertParagraph(element, messages, options) {
        return htmlPathForParagraph(element, messages).wrap(function() {'''
new = '''    function convertParagraph(element, messages, options) {
        var htmlPath = htmlPathForParagraph(element, messages);
        htmlPath = withParagraphAlignment(htmlPath, element.alignment);

        return htmlPath.wrap(function() {'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not update convertParagraph")
    text = text.replace(old, new, 1)

if 'function withParagraphAlignment(path, alignment)' not in text:
    marker = '    function htmlPathForParagraph(element, messages) {'
    helper = '''    function withParagraphAlignment(path, alignment) {
        var cssAlignment = cssAlignmentFor(alignment);
        if (!preserveAlignment || !cssAlignment || !path || !path._elements || path._elements.length === 0) {
            return path;
        }

        var elements = path._elements.slice();
        var index = elements.length - 1;
        var element = elements[index];
        var attributes = _.extend({}, element.attributes || {});
        attributes.style = appendStyle(attributes.style, "text-align: " + cssAlignment);
        elements[index] = htmlPaths.element(
            Object.keys(element.tagNames || {}).length > 1 ? Object.keys(element.tagNames) : element.tagName,
            attributes,
            {fresh: element.fresh, separator: element.separator}
        );

        return htmlPaths.elements(elements);
    }

    function cssAlignmentFor(alignment) {
        if (!alignment) {
            return null;
        }

        if (alignment === "both" || alignment === "distribute") {
            return "justify";
        }

        if (alignment === "left" || alignment === "right" || alignment === "center" ||
                alignment === "start" || alignment === "end" || alignment === "justify") {
            return alignment;
        }

        return null;
    }

    function appendStyle(existingStyle, style) {
        if (!existingStyle) {
            return style;
        }

        var separator = /;\\s*$/.test(existingStyle) ? " " : "; ";
        return existingStyle + separator + style;
    }

'''
    if marker not in text:
        raise SystemExit("Could not locate htmlPathForParagraph")
    text = text.replace(marker, helper + marker, 1)

path.write_text(text)

# tests
path = Path("test/alignment.tests.js")
path.write_text(r'''var assert = require("assert");

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
''')

# README
path = Path("README.md")
text = path.read_text()
if "preserveAlignment" not in text:
    old = '''  * `ignoreEmptyParagraphs`: by default, empty paragraphs are ignored.
    Set this option to `false` to preserve empty paragraphs in the output.

  * `idPrefix`:'''
    new = '''  * `ignoreEmptyParagraphs`: by default, empty paragraphs are ignored.
    Set this option to `false` to preserve empty paragraphs in the output.

  * `preserveAlignment`: by default, paragraph alignment is not written to HTML.
    Set this option to `true` to preserve Word paragraph alignment as inline `text-align` CSS.
    This also applies to paragraphs inside table cells. Word's `both` and `distribute` values are mapped to CSS `justify`.

  * `idPrefix`:'''
    if old not in text:
        raise SystemExit("Could not document preserveAlignment")
    path.write_text(text.replace(old, new, 1))
