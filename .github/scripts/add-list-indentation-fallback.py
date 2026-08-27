from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit("Could not find expected text in %s" % path)
    path.write_text(text.replace(old, new, 1))


# Public option -------------------------------------------------------------
path = Path("lib/options-reader.js")
replace_once(
    path,
    '    numberingClassMap: []\n',
    '    inferListNestingFromIndentation: false,\n    numberingClassMap: []\n',
)

path = Path("lib/index.d.ts")
replace_once(
    path,
    '    numberingClassMap?: Array<NumberingClassMapping>;\n',
    '    inferListNestingFromIndentation?: boolean;\n    numberingClassMap?: Array<NumberingClassMapping>;\n',
)


# Preserve indentation from numbering.xml ----------------------------------
path = Path("lib/docx/numbering-xml.js")
text = path.read_text()
if "indent: readLevelIndent" not in text:
    old = '''        var paragraphStyleId = levelElement.firstOrEmpty("w:pStyle").attributes["w:val"];
        var level = {
            isOrdered: isOrdered,
            level: levelIndex === undefined ? "0" : levelIndex,
            paragraphStyleId: paragraphStyleId,
            numFmt: numFmt,
            levelText: levelText
        };'''
    new = '''        var paragraphStyleId = levelElement.firstOrEmpty("w:pStyle").attributes["w:val"];
        var level = {
            isOrdered: isOrdered,
            level: levelIndex === undefined ? "0" : levelIndex,
            paragraphStyleId: paragraphStyleId,
            numFmt: numFmt,
            levelText: levelText,
            indent: readLevelIndent(levelElement.firstOrEmpty("w:pPr").firstOrEmpty("w:ind"))
        };'''
    if old not in text:
        raise SystemExit("Could not add numbering level indentation")
    text = text.replace(old, new, 1)

    marker = 'function readNums(root) {'
    helper = '''function readLevelIndent(element) {
    return {
        start: element.attributes["w:start"] || element.attributes["w:left"],
        end: element.attributes["w:end"] || element.attributes["w:right"],
        firstLine: element.attributes["w:firstLine"],
        hanging: element.attributes["w:hanging"]
    };
}

'''
    if marker not in text:
        raise SystemExit("Could not locate readNums")
    text = text.replace(marker, helper + marker, 1)
    path.write_text(text)


# Infer logical nesting from effective left indentation ---------------------
path = Path("lib/document-to-html.js")
text = path.read_text()

text = text.replace(
    'options = _.extend({ignoreEmptyParagraphs: true, numberingClassMap: []}, options);',
    'options = _.extend({ignoreEmptyParagraphs: true, numberingClassMap: [], inferListNestingFromIndentation: false}, options);',
    1,
)
if 'var inferListNestingFromIndentation = !!options.inferListNestingFromIndentation;' not in text:
    text = text.replace(
        '    var numberingClassMap = options.numberingClassMap || [];\n',
        '    var numberingClassMap = options.numberingClassMap || [];\n'
        '    var inferListNestingFromIndentation = !!options.inferListNestingFromIndentation;\n',
        1,
    )

if 'function resolveListLevel(element, indentationLevels)' not in text:
    marker = '    function convertElements(elements, messages, options) {'
    helpers = '''    function resolveListLevel(element, indentationLevels) {
        var originalLevel = parseListLevel(element.numbering.level);
        if (!inferListNestingFromIndentation) {
            return originalLevel;
        }

        var indent = effectiveListIndent(element);
        if (indent === null) {
            return originalLevel;
        }

        // Explicit Word levels remain authoritative. The indentation fallback
        // is only intended for documents that flatten nested lists to ilvl=0.
        if (originalLevel > 0) {
            indentationLevels[originalLevel] = indent;
            indentationLevels.length = originalLevel + 1;
            return originalLevel;
        }

        if (indentationLevels.length === 0) {
            indentationLevels.push(indent);
            return 0;
        }

        var matchingLevel = findIndentationLevel(indentationLevels, indent);
        if (matchingLevel !== -1) {
            indentationLevels.length = matchingLevel + 1;
            return matchingLevel;
        }

        while (indentationLevels.length > 1 &&
                indent < indentationLevels[indentationLevels.length - 1] - 20) {
            indentationLevels.pop();
        }

        var currentIndent = indentationLevels[indentationLevels.length - 1];
        if (indent > currentIndent + 20) {
            indentationLevels.push(indent);
            return indentationLevels.length - 1;
        }

        indentationLevels[indentationLevels.length - 1] = indent;
        return indentationLevels.length - 1;
    }

    function findIndentationLevel(indentationLevels, indent) {
        for (var index = 0; index < indentationLevels.length; index++) {
            if (Math.abs(indentationLevels[index] - indent) <= 20) {
                return index;
            }
        }
        return -1;
    }

    function effectiveListIndent(element) {
        var paragraphIndent = numericIndent(element.indent && element.indent.start);
        if (paragraphIndent !== null) {
            return paragraphIndent;
        }

        return numericIndent(
            element.numbering &&
            element.numbering.indent &&
            element.numbering.indent.start
        );
    }

    function numericIndent(value) {
        if (value === undefined || value === null || value === "") {
            return null;
        }
        var parsed = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
    }

    function parseListLevel(value) {
        var parsed = parseInt(value, 10);
        return isNaN(parsed) ? 0 : parsed;
    }

'''
    if marker not in text:
        raise SystemExit("Could not locate convertElements")
    text = text.replace(marker, helpers + marker, 1)

# Add local nesting state to convertElements.
if 'var listIndentationLevels = [];' not in text:
    old = '''        var lastListKey = null;
        var lastWasListItem = false;
        var continuedListStartNumber = null;'''
    new = '''        var lastListKey = null;
        var lastWasListItem = false;
        var lastListLevel = null;
        var continuedListStartNumber = null;
        var listIndentationLevels = [];'''
    if old not in text:
        raise SystemExit("Could not add list indentation state")
    text = text.replace(old, new, 1)

# Calculate logical list level and use it for list-state tracking.
old = '''                var numbering = element.numbering;
                var listKey = (numbering.numId || "default") + "_" + numbering.level + "_" + numbering.isOrdered;'''
new = '''                var numbering = element.numbering;
                var listLevel = resolveListLevel(element, listIndentationLevels);
                var listKey = (numbering.numId || "default") + "_" + listLevel + "_" + numbering.isOrdered;'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not update list key")
    text = text.replace(old, new, 1)

# Returning from a deeper nested list is not an interruption of the parent.
old = '''                if (listKey === lastListKey && lastWasListItem) {
                    // Same list, consecutive items - use the same start number if in a continued list
                    isListContinuation = false;
                } else if (listState.currentLists[listKey].count > 0) {'''
new = '''                var returningFromNestedList = lastWasListItem &&
                    lastListLevel !== null && listLevel < lastListLevel;
                if (listKey === lastListKey && lastWasListItem) {
                    // Same list, consecutive items - use the same start number if in a continued list
                    isListContinuation = false;
                } else if (returningFromNestedList) {
                    // A child list has ended. Keep the parent HTML list open rather
                    // than restarting it with a start attribute.
                    isListContinuation = false;
                } else if (listState.currentLists[listKey].count > 0) {'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not update list continuation logic")
    text = text.replace(old, new, 1)

# Different numIds only force a new list when they are peers, not parent/child.
old = '                if (lastListKey !== null && listKey !== lastListKey && lastWasListItem) {'
new = '                if (lastListKey !== null && listKey !== lastListKey && lastWasListItem && listLevel === lastListLevel) {'
if new not in text:
    if old not in text:
        raise SystemExit("Could not update force-new-list logic")
    text = text.replace(old, new, 1)

# Pass the logical level into paragraph conversion.
old = '''                    continuedListStartNumber: !isListContinuation && continuedListStartNumber && listKey === lastListKey && lastWasListItem ? continuedListStartNumber : null,
                    forceNewList: isNewList
                });'''
new = '''                    continuedListStartNumber: !isListContinuation && continuedListStartNumber && listKey === lastListKey && lastWasListItem ? continuedListStartNumber : null,
                    forceNewList: isNewList,
                    listLevel: listLevel
                });'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not pass logical list level")
    text = text.replace(old, new, 1)

# Remember logical level, and reset indentation context after normal paragraphs.
old = '''                lastListKey = listKey;
                lastWasListItem = true;
                
                result = result.concat(converted);'''
new = '''                lastListKey = listKey;
                lastWasListItem = true;
                lastListLevel = listLevel;
                
                result = result.concat(converted);'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not store last list level")
    text = text.replace(old, new, 1)

old = '''                lastWasListItem = false;
                continuedListStartNumber = null; // Reset when we leave the list
                result = result.concat(elementToHtml(element, messages, options));'''
new = '''                lastWasListItem = false;
                lastListLevel = null;
                continuedListStartNumber = null; // Reset when we leave the list
                listIndentationLevels = [];
                result = result.concat(elementToHtml(element, messages, options));'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not reset indentation context")
    text = text.replace(old, new, 1)

# Use the inferred level only for style-path selection. Keep the original Word
# numbering metadata for numberingClassMap matching and startOverride.
old = '''    function convertParagraph(element, messages, options) {
        var htmlPath = htmlPathForParagraph(element, messages);'''
new = '''    function convertParagraph(element, messages, options) {
        var paragraphForStyle = element;
        if (element.numbering && options && options.listLevel !== undefined &&
                String(options.listLevel) !== String(element.numbering.level)) {
            paragraphForStyle = _.extend({}, element, {
                numbering: _.extend({}, element.numbering, {
                    level: String(options.listLevel)
                })
            });
        }

        var htmlPath = htmlPathForParagraph(paragraphForStyle, messages);'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not update convertParagraph")
    text = text.replace(old, new, 1)

path.write_text(text)


# Tests ---------------------------------------------------------------------
path = Path("test/list-indentation.tests.js")
if not path.exists():
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
''')

path = Path("test/docx/numbering-indentation.tests.js")
if not path.exists():
    path.write_text(r'''var assert = require("assert");

var readNumberingXml = require("../../lib/docx/numbering-xml").readNumberingXml;
var stylesReader = require("../../lib/docx/styles-reader");
var XmlElement = require("../../lib/xml").Element;
var test = require("../test")(module);


test('numbering level preserves paragraph indentation', function() {
    var numbering = readNumberingXml(
        new XmlElement("w:numbering", {}, [
            new XmlElement("w:abstractNum", {"w:abstractNumId": "42"}, [
                new XmlElement("w:lvl", {"w:ilvl": "0"}, [
                    new XmlElement("w:numFmt", {"w:val": "bullet"}),
                    new XmlElement("w:pPr", {}, [
                        new XmlElement("w:ind", {
                            "w:left": "1058",
                            "w:hanging": "425"
                        })
                    ])
                ])
            ]),
            new XmlElement("w:num", {"w:numId": "47"}, [
                new XmlElement("w:abstractNumId", {"w:val": "42"})
            ])
        ]),
        {styles: stylesReader.defaultStyles}
    );

    var level = numbering.findLevel("47", "0");
    assert.equal(level.indent.start, "1058");
    assert.equal(level.indent.hanging, "425");
});
''')


# README --------------------------------------------------------------------
path = Path("README.md")
text = path.read_text()
if "inferListNestingFromIndentation" not in text:
    old = '''  * `ignoreEmptyParagraphs`: by default, empty paragraphs are ignored.
    Set this option to `false` to preserve empty paragraphs in the output.

  * `idPrefix`:'''
    new = '''  * `ignoreEmptyParagraphs`: by default, empty paragraphs are ignored.
    Set this option to `false` to preserve empty paragraphs in the output.

  * `inferListNestingFromIndentation`: by default, list nesting follows Word's numbering level (`w:ilvl`).
    Set this option to `true` to use the effective left indentation as a fallback when a document stores visually nested lists as separate level-zero numbering definitions.
    Explicit numbering levels greater than zero remain authoritative, and direct paragraph indentation takes precedence over indentation from the numbering definition.
    This fallback only affects paragraphs that are actual Word lists; manually typed prefixes such as `(1)` are not converted into lists.

  * `idPrefix`:'''
    if old not in text:
        raise SystemExit("Could not document indentation option")
    path.write_text(text.replace(old, new, 1))
