from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Could not find expected text in {path}")
    path.write_text(text.replace(old, new, 1))


path = Path("lib/document-to-html.js")
text = path.read_text()

old = '''    function convertParagraph(element, messages, options) {
        var htmlPath = htmlPathForParagraph(element, messages);
        htmlPath = withParagraphAlignment(htmlPath, element.alignment);

        return htmlPath.wrap(function() {
'''
new = '''    function convertParagraph(element, messages, options) {
        var htmlPath = htmlPathForParagraph(element, messages);
        var cssAlignment = cssAlignmentFor(element.alignment);
        if (cssAlignment !== options.tableCellAlignment) {
            htmlPath = withParagraphAlignment(htmlPath, element.alignment);
        }

        return htmlPath.wrap(function() {
'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not update paragraph alignment handling")
    text = text.replace(old, new, 1)

old = '''        if (alignment === "both" || alignment === "distribute") {
            return "justify";
        }

        if (alignment === "left" || alignment === "right" || alignment === "center" ||
                alignment === "start" || alignment === "end" || alignment === "justify") {
            return alignment;
        }
'''
new = '''        if (alignment === "both" || alignment === "distribute") {
            return "justify";
        }

        if (alignment === "start") {
            return "left";
        }

        if (alignment === "end") {
            return "right";
        }

        if (alignment === "left" || alignment === "right" || alignment === "center" ||
                alignment === "justify") {
            return alignment;
        }
'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not update logical alignment mapping")
    text = text.replace(old, new, 1)

old = '''    function convertTableCell(element, messages, options) {
        var tagName = options.isTableHeader ? "th" : "td";
        var children = convertElements(element.children, messages, options);
        var attributes = {};
        if (element.colSpan !== 1) {
            attributes.colspan = element.colSpan.toString();
        }
        if (element.rowSpan !== 1) {
            attributes.rowspan = element.rowSpan.toString();
        }

        return [
            Html.freshElement(tagName, attributes, [Html.forceWrite].concat(children))
        ];
    }
'''
new = '''    function convertTableCell(element, messages, options) {
        var tagName = options.isTableHeader ? "th" : "td";
        var cellAlignment = commonTableCellAlignment(element);
        var childOptions = _.extend({}, options, {tableCellAlignment: cellAlignment});
        var children = convertElements(element.children, messages, childOptions);
        var attributes = {};
        if (element.colSpan !== 1) {
            attributes.colspan = element.colSpan.toString();
        }
        if (element.rowSpan !== 1) {
            attributes.rowspan = element.rowSpan.toString();
        }
        if (preserveAlignment && cellAlignment) {
            attributes.style = "text-align: " + cellAlignment;
        }

        return [
            Html.freshElement(tagName, attributes, [Html.forceWrite].concat(children))
        ];
    }

    function commonTableCellAlignment(element) {
        var alignments = element.children
            .filter(function(child) {
                return child.type === documents.types.paragraph;
            })
            .map(function(child) {
                return cssAlignmentFor(child.alignment);
            })
            .filter(function(alignment) {
                return !!alignment;
            });

        if (alignments.length === 0) {
            return null;
        }

        var firstAlignment = alignments[0];
        return alignments.every(function(alignment) {
            return alignment === firstAlignment;
        }) ? firstAlignment : null;
    }
'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not update table cell conversion")
    text = text.replace(old, new, 1)

path.write_text(text)


path = Path("test/alignment.tests.js")
text = path.read_text()
if "Word end alignment maps to CSS right" not in text:
    text += '''\n\ntest('Word start alignment maps to CSS left', function() {
    return converter({preserveAlignment: true}).convertToHtml(paragraph("Start", "start")).then(function(result) {
        assert.equal(result.value, '<p style="text-align: left">Start</p>');
    });
});


test('Word end alignment maps to CSS right', function() {
    return converter({preserveAlignment: true}).convertToHtml(paragraph("End", "end")).then(function(result) {
        assert.equal(result.value, '<p style="text-align: right">End</p>');
    });
});
'''
    path.write_text(text)
