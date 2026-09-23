var _ = require("underscore");

var promises = require("./promises");
var documents = require("./documents");
var htmlPaths = require("./styles/html-paths");
var results = require("./results");
var images = require("./images");
var Html = require("./html");
var writers = require("./writers");

exports.DocumentConverter = DocumentConverter;


function DocumentConverter(options) {
    return {
        convertToHtml: function(element) {
            var comments = _.indexBy(
                element.type === documents.types.document ? element.comments : [],
                "commentId"
            );
            var conversion = new DocumentConversion(options, comments);
            return conversion.convertToHtml(element);
        }
    };
}

function DocumentConversion(options, comments) {
    var noteNumber = 1;

    var noteReferences = [];

    var referencedComments = [];

    options = _.extend({
        ignoreEmptyParagraphs: true,
        numberingClassMap: [],
        preserveHeadingNumbering: false,
        inferListNestingFromIndentation: false,
        preserveAlignment: false
    }, options);
    var idPrefix = options.idPrefix === undefined ? "" : options.idPrefix;
    var ignoreEmptyParagraphs = options.ignoreEmptyParagraphs;
    var numberingClassMap = options.numberingClassMap || [];
    var preserveHeadingNumbering = options.preserveHeadingNumbering;
    var inferListNestingFromIndentation = !!options.inferListNestingFromIndentation;
    var preserveAlignment = !!options.preserveAlignment;
    var numberingCounters = Object.create(null);

    var defaultParagraphStyle = htmlPaths.topLevelElement("p");

    var styleMap = options.styleMap || [];

    function convertToHtml(document) {
        var messages = [];

        var html = elementToHtml(document, messages, Object.create(null));

        var deferredNodes = [];
        walkHtml(html, function(node) {
            if (node.type === "deferred") {
                deferredNodes.push(node);
            }
        });
        var deferredValues = Object.create(null);
        return promises.forEachSeries(deferredNodes, function(deferred) {
            return deferred.value().then(function(value) {
                deferredValues[deferred.id] = value;
            });
        }).then(function() {
            function replaceDeferred(nodes) {
                return flatMap(nodes, function(node) {
                    if (node.type === "deferred") {
                        return deferredValues[node.id];
                    } else if (node.children) {
                        return [
                            _.extend({}, node, {
                                children: replaceDeferred(node.children)
                            })
                        ];
                    } else {
                        return [node];
                    }
                });
            }
            var writer = writers.writer({
                prettyPrint: options.prettyPrint,
                outputFormat: options.outputFormat
            });
            Html.write(writer, Html.simplify(replaceDeferred(html)));
            return new results.Result(writer.asString(), messages);
        });
    }

    function resolveListLevel(element, indentationLevels) {
        var originalLevel = parseListLevel(element.numbering.level);
        if (!inferListNestingFromIndentation) {
            return originalLevel;
        }

        var indent = effectiveListIndent(element);
        if (indent === null) {
            return originalLevel;
        }

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

    function convertElements(elements, messages, context) {
        var result = [];
        var listIndentationLevels = [];
        var orderedListCounts = Object.create(null);
        var listInterrupted = false;

        for (var i = 0; i < elements.length; i++) {
            var element = elements[i];
            if (element.type === documents.types.paragraph && element.numbering &&
                    !rendersAsNumberedHeading(element)) {
                var listLevel = resolveListLevel(element, listIndentationLevels);
                var numbering = element.numbering;
                var listKey = numbering.numId !== undefined ?
                    numbering.numId + "_" + listLevel : null;
                var listStartNumber = null;

                if (numbering.isOrdered && listKey !== null) {
                    var previousCount = orderedListCounts[listKey] || 0;
                    if (listInterrupted && previousCount > 0) {
                        listStartNumber = previousCount + 1;
                    }
                    orderedListCounts[listKey] = previousCount + 1;
                }

                var elementContext = _.extend({}, context, {
                    listLevel: listLevel,
                    listStartNumber: listStartNumber
                });
                result = result.concat(elementToHtml(element, messages, elementContext));
                listInterrupted = false;
            } else {
                listIndentationLevels = [];
                if (!isIgnoredEmptyParagraph(element)) {
                    listInterrupted = true;
                }
                result = result.concat(elementToHtml(element, messages, context));
            }
        }

        return result;
    }

    function isIgnoredEmptyParagraph(element) {
        return ignoreEmptyParagraphs && element.type === documents.types.paragraph &&
            (!element.children || element.children.length === 0);
    }

    function rendersAsNumberedHeading(element) {
        if (!preserveHeadingNumbering || !element.numbering ||
                !element.numbering.isOrdered) {
            return false;
        }

        var style = findStyle(element);
        return style && isHeadingPath(style.to);
    }

    function elementToHtml(element, messages, context) {
        if (!context) {
            throw new Error("context not set");
        }
        var handler = elementConverters[element.type];
        if (handler) {
            return handler(element, messages, context);
        } else {
            return [];
        }
    }

    function convertParagraph(element, messages, context) {
        var paragraphForStyle = element;
        if (element.numbering && context && context.listLevel !== undefined &&
                String(context.listLevel) !== String(element.numbering.level)) {
            paragraphForStyle = _.extend({}, element, {
                numbering: _.extend({}, element.numbering, {
                    level: String(context.listLevel)
                })
            });
        }

        var path = htmlPathForParagraph(paragraphForStyle, messages);

        if (context.listStartNumber && element.numbering && element.numbering.isOrdered) {
            path = withListStartNumber(path, context.listStartNumber);
        }
        path = withNumberingClass(path, element.numbering);

        var cssAlignment = cssAlignmentFor(element.alignment);
        if (cssAlignment !== context.tableCellAlignment) {
            path = withParagraphAlignment(path, element.alignment);
        }

        var renderNumberingLabel = preserveHeadingNumbering && isHeadingPath(path);
        var numberingLabel = renderNumberingLabel
            ? nextNumberingLabel(element.numbering)
            : null;

        return path.wrap(function() {
            var content = convertElements(element.children, messages, context);
            if (numberingLabel !== null) {
                content = [Html.text(numberingLabel + " ")].concat(content);
            }

            if (ignoreEmptyParagraphs) {
                return content;
            } else {
                return [Html.forceWrite].concat(content);
            }
        });
    }

    function isHeadingPath(path) {
        if (!path || !path._elements) {
            return false;
        }

        return path._elements.some(function(element) {
            return /^h[1-6]$/.test(element.tagName);
        });
    }

    function nextNumberingLabel(numbering) {
        if (!numbering || !numbering.isOrdered || !numbering.numId ||
                !numbering.levels || !numbering.levelText) {
            return null;
        }

        var levelIndex = parseInt(numbering.level, 10);
        if (isNaN(levelIndex)) {
            return null;
        }

        var counters = numberingCounters[numbering.numId];
        if (!counters) {
            counters = Object.create(null);
            numberingCounters[numbering.numId] = counters;
        }

        var currentLevel = numbering.levels[levelIndex] || numbering;
        if (counters[levelIndex] === undefined) {
            counters[levelIndex] = startValue(currentLevel);
        } else {
            counters[levelIndex]++;
        }

        Object.keys(counters).forEach(function(index) {
            if (parseInt(index, 10) > levelIndex) {
                delete counters[index];
            }
        });

        return numbering.levelText.replace(/%([1-9])/g, function(match, number) {
            var referencedLevelIndex = parseInt(number, 10) - 1;
            var referencedLevel = numbering.levels[referencedLevelIndex];

            if (counters[referencedLevelIndex] === undefined) {
                counters[referencedLevelIndex] = startValue(referencedLevel);
            }

            return formatNumber(
                counters[referencedLevelIndex],
                referencedLevel ? referencedLevel.numFmt : numbering.numFmt
            );
        });
    }

    function startValue(level) {
        if (!level) {
            return 1;
        }

        var value = parseInt(level.start, 10);
        return isNaN(value) ? 1 : value;
    }

    function formatNumber(value, numFmt) {
        if (numFmt === "upperRoman") {
            return toRoman(value);
        } else if (numFmt === "lowerRoman") {
            return toRoman(value).toLowerCase();
        } else if (numFmt === "upperLetter") {
            return toLetters(value);
        } else if (numFmt === "lowerLetter") {
            return toLetters(value).toLowerCase();
        } else {
            return String(value);
        }
    }

    function toLetters(value) {
        if (value < 1) {
            return String(value);
        }

        var result = "";
        while (value > 0) {
            value--;
            result = String.fromCharCode(65 + (value % 26)) + result;
            value = Math.floor(value / 26);
        }
        return result;
    }

    function toRoman(value) {
        if (value < 1 || value > 3999) {
            return String(value);
        }

        var roman = [
            [1000, "M"],
            [900, "CM"],
            [500, "D"],
            [400, "CD"],
            [100, "C"],
            [90, "XC"],
            [50, "L"],
            [40, "XL"],
            [10, "X"],
            [9, "IX"],
            [5, "V"],
            [4, "IV"],
            [1, "I"]
        ];
        var result = "";

        roman.forEach(function(entry) {
            while (value >= entry[0]) {
                result += entry[1];
                value -= entry[0];
            }
        });

        return result;
    }

    function withListStartNumber(path, startNumber) {
        if (!path || !path._elements) {
            return path;
        }

        var elements = path._elements.slice();
        for (var index = elements.length - 1; index >= 0; index--) {
            var element = elements[index];
            if (element.tagName === "ol" || (element.tagNames && element.tagNames.ol)) {
                elements[index] = _.extend({}, element, {
                    attributes: _.extend({}, element.attributes || {}, {
                        start: startNumber.toString()
                    })
                });
                break;
            }
        }
        return htmlPaths.elements(elements);
    }

    function withParagraphAlignment(path, alignment) {
        var cssAlignment = cssAlignmentFor(alignment);
        if (!preserveAlignment || !cssAlignment || !path ||
                !path._elements || path._elements.length === 0) {
            return path;
        }

        var elements = path._elements.slice();
        var index = elements.length - 1;
        var element = elements[index];
        var attributes = _.extend({}, element.attributes || {});
        attributes.style = appendStyle(attributes.style, "text-align: " + cssAlignment);
        elements[index] = htmlPaths.element(
            Object.keys(element.tagNames || {}).length > 1 ?
                Object.keys(element.tagNames) :
                element.tagName,
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
        if (alignment === "start") {
            return "left";
        }
        if (alignment === "end") {
            return "right";
        }
        if (alignment === "left" || alignment === "right" ||
                alignment === "center" || alignment === "justify") {
            return alignment;
        }
        return null;
    }

    function appendStyle(existingStyle, style) {
        if (!existingStyle) {
            return style;
        }
        var separator = /;\s*$/.test(existingStyle) ? " " : "; ";
        return existingStyle + separator + style;
    }

    function withNumberingClass(path, numbering) {
        var className = numberingClassFor(numbering);
        if (!className || !path || !path._elements || path._elements.length === 0) {
            return path;
        }

        var elements = path._elements.slice();
        for (var index = elements.length - 1; index >= 0; index--) {
            var element = elements[index];
            if (element.tagName === "ol" || element.tagName === "ul") {
                var attributes = _.extend({}, element.attributes || {});
                attributes["class"] = appendClass(attributes["class"], className);
                elements[index] = htmlPaths.element(
                    Object.keys(element.tagNames || {}).length > 1 ? Object.keys(element.tagNames) : element.tagName,
                    attributes,
                    {fresh: element.fresh, separator: element.separator}
                );
                break;
            }
        }

        return htmlPaths.elements(elements);
    }

    function appendClass(existingClassName, className) {
        if (!existingClassName) {
            return className;
        }
        return existingClassName + " " + className;
    }

    function numberingClassFor(numbering) {
        if (!numbering) {
            return null;
        }

        var classes = numberingClassMap.filter(function(mapping) {
            return matchesNumberingClassMapping(mapping, numbering);
        }).map(function(mapping) {
            return mapping.className;
        }).filter(function(className) {
            return !!className;
        });

        return classes.length > 0 ? classes.join(" ") : null;
    }

    function matchesNumberingClassMapping(mapping, numbering) {
        return (mapping.numFmt === undefined || mapping.numFmt === numbering.numFmt) &&
            (mapping.levelText === undefined || mapping.levelText === numbering.levelText) &&
            (mapping.level === undefined || String(mapping.level) === String(numbering.level));
    }

    function htmlPathForParagraph(element, messages) {
        var style = findStyle(element);

        if (style) {
            return style.to;
        } else {
            if (element.styleId) {
                messages.push(unrecognisedStyleWarning("paragraph", element));
            }
            return defaultParagraphStyle;
        }
    }

    function convertRun(run, messages, context) {
        var nodes = function() {
            return convertElements(run.children, messages, context);
        };
        var paths = [];
        if (run.highlight !== null) {
            var path = findHtmlPath({type: "highlight", color: run.highlight});
            if (path) {
                paths.push(path);
            }
        }
        if (run.isSmallCaps) {
            paths.push(findHtmlPathForRunProperty("smallCaps"));
        }
        if (run.isAllCaps) {
            paths.push(findHtmlPathForRunProperty("allCaps"));
        }
        if (run.isStrikethrough) {
            paths.push(findHtmlPathForRunProperty("strikethrough", "s"));
        }
        if (run.isUnderline) {
            paths.push(findHtmlPathForRunProperty("underline"));
        }
        if (run.verticalAlignment === documents.verticalAlignment.subscript) {
            paths.push(htmlPaths.element("sub", {}, {fresh: false}));
        }
        if (run.verticalAlignment === documents.verticalAlignment.superscript) {
            paths.push(htmlPaths.element("sup", {}, {fresh: false}));
        }
        if (run.isItalic) {
            paths.push(findHtmlPathForRunProperty("italic", "em"));
        }
        if (run.isBold) {
            paths.push(findHtmlPathForRunProperty("bold", "strong"));
        }
        var stylePath = htmlPaths.empty;
        var style = findStyle(run);
        if (style) {
            stylePath = style.to;
        } else if (run.styleId) {
            messages.push(unrecognisedStyleWarning("run", run));
        }
        paths.push(stylePath);

        paths.forEach(function(path) {
            nodes = path.wrap.bind(path, nodes);
        });

        return nodes();
    }

    function findHtmlPathForRunProperty(elementType, defaultTagName) {
        var path = findHtmlPath({type: elementType});
        if (path) {
            return path;
        } else if (defaultTagName) {
            return htmlPaths.element(defaultTagName, {}, {fresh: false});
        } else {
            return htmlPaths.empty;
        }
    }

    function findHtmlPath(element, defaultPath) {
        var style = findStyle(element);
        return style ? style.to : defaultPath;
    }

    function findStyle(element) {
        for (var i = 0; i < styleMap.length; i++) {
            if (styleMap[i].from.matches(element)) {
                return styleMap[i];
            }
        }
    }

    function recoveringConvertImage(convertImage) {
        return function(image, messages) {
            return promises.try(function() {
                return convertImage(image, messages);
            }).catch(function(error) {
                messages.push(results.error(error));
                return [];
            });
        };
    }

    function noteHtmlId(note) {
        return referentHtmlId(note.noteType, note.noteId);
    }

    function noteRefHtmlId(note) {
        return referenceHtmlId(note.noteType, note.noteId);
    }

    function referentHtmlId(referenceType, referenceId) {
        return htmlId(referenceType + "-" + referenceId);
    }

    function referenceHtmlId(referenceType, referenceId) {
        return htmlId(referenceType + "-ref-" + referenceId);
    }

    function htmlId(suffix) {
        return idPrefix + suffix;
    }

    var defaultTablePath = htmlPaths.elements([
        htmlPaths.element("table", {}, {fresh: true})
    ]);

    function convertTable(element, messages, context) {
        return findHtmlPath(element, defaultTablePath).wrap(function() {
            return convertTableChildren(element, messages, context);
        });
    }

    function convertTableChildren(element, messages, context) {
        var bodyIndex = _.findIndex(element.children, function(child) {
            return !child.type === documents.types.tableRow || !child.isHeader;
        });
        if (bodyIndex === -1) {
            bodyIndex = element.children.length;
        }
        var children;
        if (bodyIndex === 0) {
            children = convertElements(
                element.children,
                messages,
                _.extend({}, context, {isTableHeader: false})
            );
        } else {
            var headRows = convertElements(
                element.children.slice(0, bodyIndex),
                messages,
                _.extend({}, context, {isTableHeader: true})
            );
            var bodyRows = convertElements(
                element.children.slice(bodyIndex),
                messages,
                _.extend({}, context, {isTableHeader: false})
            );
            children = [
                Html.freshElement("thead", {}, headRows),
                Html.freshElement("tbody", {}, bodyRows)
            ];
        }
        return [Html.forceWrite].concat(children);
    }

    function convertTableRow(element, messages, context) {
        var children = convertElements(element.children, messages, context);
        return [
            Html.freshElement("tr", {}, [Html.forceWrite].concat(children))
        ];
    }

    function convertTableCell(element, messages, context) {
        var tagName = context.isTableHeader ? "th" : "td";
        var cellAlignment = commonTableCellAlignment(element);
        var childContext = _.extend({}, context, {tableCellAlignment: cellAlignment});
        var children = convertElements(element.children, messages, childContext);
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

    function convertCommentReference(reference, messages, context) {
        return findHtmlPath(reference, htmlPaths.ignore).wrap(function() {
            var comment = comments[reference.commentId];
            var count = referencedComments.length + 1;
            var label = "[" + commentAuthorLabel(comment) + count + "]";
            referencedComments.push({label: label, comment: comment});
            // TODO: remove duplication with note references
            return [
                Html.freshElement("a", {
                    href: "#" + referentHtmlId("comment", reference.commentId),
                    id: referenceHtmlId("comment", reference.commentId)
                }, [Html.text(label)])
            ];
        });
    }

    function convertComment(referencedComment, messages, context) {
        // TODO: remove duplication with note references

        var label = referencedComment.label;
        var comment = referencedComment.comment;
        var body = convertElements(comment.body, messages, context).concat([
            Html.nonFreshElement("p", {}, [
                Html.text(" "),
                Html.freshElement("a", {"href": "#" + referenceHtmlId("comment", comment.commentId)}, [
                    Html.text("↑")
                ])
            ])
        ]);

        return [
            Html.freshElement(
                "dt",
                {"id": referentHtmlId("comment", comment.commentId)},
                [Html.text("Comment " + label)]
            ),
            Html.freshElement("dd", {}, body)
        ];
    }

    function convertBreak(element, messages, context) {
        return htmlPathForBreak(element).wrap(function() {
            return [];
        });
    }

    function htmlPathForBreak(element) {
        var style = findStyle(element);
        if (style) {
            return style.to;
        } else if (element.breakType === "line") {
            return htmlPaths.topLevelElement("br");
        } else {
            return htmlPaths.empty;
        }
    }

    var elementConverters = {
        "document": function(document, messages, context) {
            var children = convertElements(document.children, messages, context);
            var notes = noteReferences.map(function(noteReference) {
                return document.notes.resolve(noteReference);
            });
            var notesNodes = convertElements(notes, messages, context);
            return children.concat([
                Html.freshElement("ol", {}, notesNodes),
                Html.freshElement("dl", {}, flatMap(referencedComments, function(referencedComment) {
                    return convertComment(referencedComment, messages, context);
                }))
            ]);
        },
        "paragraph": convertParagraph,
        "run": convertRun,
        "text": function(element, messages, context) {
            return [Html.text(element.value)];
        },
        "tab": function(element, messages, context) {
            return [Html.text("\t")];
        },
        "hyperlink": function(element, messages, context) {
            var href = element.anchor ? "#" + htmlId(element.anchor) : element.href;
            var attributes = {href: href};
            if (element.targetFrame != null) {
                attributes.target = element.targetFrame;
            }

            var children = convertElements(element.children, messages, context);
            return [Html.nonFreshElement("a", attributes, children)];
        },
        "checkbox": function(element) {
            var attributes = {type: "checkbox"};
            if (element.checked) {
                attributes["checked"] = "checked";
            }
            return [Html.freshElement("input", attributes)];
        },
        "bookmarkStart": function(element, messages, context) {
            var anchor = Html.freshElement("a", {
                id: htmlId(element.name)
            }, [Html.forceWrite]);
            return [anchor];
        },
        "noteReference": function(element, messages, context) {
            noteReferences.push(element);
            var anchor = Html.freshElement("a", {
                href: "#" + noteHtmlId(element),
                id: noteRefHtmlId(element)
            }, [Html.text("[" + (noteNumber++) + "]")]);

            return [Html.freshElement("sup", {}, [anchor])];
        },
        "note": function(element, messages, context) {
            var children = convertElements(element.body, messages, context);
            var backLink = Html.elementWithTag(htmlPaths.element("p", {}, {fresh: false}), [
                Html.text(" "),
                Html.freshElement("a", {href: "#" + noteRefHtmlId(element)}, [Html.text("↑")])
            ]);
            var body = children.concat([backLink]);

            return Html.freshElement("li", {id: noteHtmlId(element)}, body);
        },
        "commentReference": convertCommentReference,
        "comment": convertComment,
        "image": deferredConversion(recoveringConvertImage(options.convertImage || images.dataUri)),
        "table": convertTable,
        "tableRow": convertTableRow,
        "tableCell": convertTableCell,
        "break": convertBreak
    };
    return {
        convertToHtml: convertToHtml
    };
}

var deferredId = 1;

function deferredConversion(func) {
    return function(element, messages, context) {
        return [
            {
                type: "deferred",
                id: deferredId++,
                value: function() {
                    return func(element, messages, context);
                }
            }
        ];
    };
}

function unrecognisedStyleWarning(type, element) {
    return results.warning(
        "Unrecognised " + type + " style: '" + element.styleName + "'" +
        " (Style ID: " + element.styleId + ")"
    );
}

function flatMap(values, func) {
    return _.flatten(values.map(func), true);
}

function walkHtml(nodes, callback) {
    nodes.forEach(function(node) {
        callback(node);
        if (node.children) {
            walkHtml(node.children, callback);
        }
    });
}

var commentAuthorLabel = exports.commentAuthorLabel = function commentAuthorLabel(comment) {
    return comment.authorInitials || "";
};
