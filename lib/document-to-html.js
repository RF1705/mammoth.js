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
    
    var listState = {
        currentLists: {} // Track current lists by key (numId + level + isOrdered)
    };

    options = _.extend({ignoreEmptyParagraphs: true, numberingClassMap: [], inferListNestingFromIndentation: false, preserveAlignment: false}, options);
    var idPrefix = options.idPrefix === undefined ? "" : options.idPrefix;
    var ignoreEmptyParagraphs = options.ignoreEmptyParagraphs;
    var numberingClassMap = options.numberingClassMap || [];
    var inferListNestingFromIndentation = !!options.inferListNestingFromIndentation;
    var preserveAlignment = !!options.preserveAlignment;

    var defaultParagraphStyle = htmlPaths.topLevelElement("p");

    var styleMap = options.styleMap || [];

    function convertToHtml(document) {
        var messages = [];

        var html = elementToHtml(document, messages, {listState: listState});

        var deferredNodes = [];
        walkHtml(html, function(node) {
            if (node.type === "deferred") {
                deferredNodes.push(node);
            }
        });
        var deferredValues = {};
        return promises.mapSeries(deferredNodes, function(deferred) {
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

    function convertElements(elements, messages, options) {
        var result = [];
        var lastListKey = null;
        var lastWasListItem = false;
        var lastListLevel = null;
        var continuedListStartNumber = null;
        var listIndentationLevels = [];
        
        for (var i = 0; i < elements.length; i++) {
            var element = elements[i];

            // Empty Word paragraphs are ignored by default and therefore must
            // not interrupt an otherwise continuous list. Treat them as
            // transparent for list-state tracking as well.
            var transparentEmptyParagraph = ignoreEmptyParagraphs &&
                isStructurallyEmptyParagraph(element);
            
            // Track list state for paragraphs with numbering
            if (!transparentEmptyParagraph && element.type === "paragraph" && element.numbering) {
                var numbering = element.numbering;
                var listLevel = resolveListLevel(element, listIndentationLevels);
                var listKey = (numbering.numId || "default") + "_" + listLevel + "_" + numbering.isOrdered;
                
                if (!listState.currentLists[listKey]) {
                    listState.currentLists[listKey] = {
                        count: 0
                    };
                }
                
                // Check if we're continuing a previous list
                var isListContinuation = false;
                // Mark as continuation only if:
                // 1. This is the same list we've seen before (same key)
                // 2. We weren't just in this list (there was a gap)
                // 3. This list has items from before
                var returningFromNestedList = lastWasListItem &&
                    lastListLevel !== null && listLevel < lastListLevel;
                if (listKey === lastListKey && lastWasListItem) {
                    // Same list, consecutive items - use the same start number if in a continued list
                    isListContinuation = false;
                } else if (returningFromNestedList) {
                    // A child list has ended. Keep the parent HTML list open rather
                    // than restarting it with a start attribute.
                    isListContinuation = false;
                } else if (listState.currentLists[listKey].count > 0) {
                    // Resuming a list after interruption
                    isListContinuation = true;
                    continuedListStartNumber = listState.currentLists[listKey].count + 1;
                } else {
                    // New list
                    continuedListStartNumber = null;
                }
                
                // Check if this is a new list (different from previous)
                // Only force new lists for ordered lists with different numIds
                var isNewList = false;
                if (lastListKey !== null && listKey !== lastListKey && lastWasListItem && listLevel === lastListLevel) {
                    var lastNumId = lastListKey.split("_")[0];
                    var currentNumId = listKey.split("_")[0];
                    var lastIsOrdered = lastListKey.split("_")[2] === "true";
                    
                    // Force new list only if it's ordered lists with different numIds
                    isNewList = numbering.isOrdered && lastIsOrdered && lastNumId !== currentNumId;
                }
                
                // Pass list continuation info in options
                var elementOptions = _.extend({}, options, {
                    listContinuation: isListContinuation,
                    listStartNumber: isListContinuation ? continuedListStartNumber : null,
                    continuedListStartNumber: !isListContinuation && continuedListStartNumber && listKey === lastListKey && lastWasListItem ? continuedListStartNumber : null,
                    forceNewList: isNewList,
                    listLevel: listLevel
                });
                
                // Special case: if this is a consecutive item without startOverride following an item with startOverride,
                // we need to use the previous item's startOverride to merge them into the same list
                if (!isListContinuation && !isNewList && !numbering.startOverride &&
                    listKey === lastListKey && lastWasListItem &&
                    elements[i - 1] && elements[i - 1].numbering && elements[i - 1].numbering.startOverride) {
                    elementOptions.continuedListStartNumber = elements[i - 1].numbering.startOverride;
                }
                
                var converted = elementToHtml(element, messages, elementOptions);
                
                // Update list count
                if (numbering.isOrdered) {
                    listState.currentLists[listKey].count++;
                }
                
                lastListKey = listKey;
                lastWasListItem = true;
                lastListLevel = listLevel;
                
                result = result.concat(converted);
            } else if (!transparentEmptyParagraph) {
                // Not a list element
                lastWasListItem = false;
                lastListLevel = null;
                continuedListStartNumber = null; // Reset when we leave the list
                listIndentationLevels = [];
                result = result.concat(elementToHtml(element, messages, options));
            }
        }
        
        return result;
    }

    function isStructurallyEmptyParagraph(element) {
        return element && element.type === documents.types.paragraph &&
            !element.numbering && paragraphHasNoContent(element);
    }

    function paragraphHasNoContent(element) {
        return !element.children || element.children.every(function(child) {
            if (child.type === documents.types.run) {
                return !child.children || child.children.every(function(runChild) {
                    return runChild.type === documents.types.text && !runChild.value;
                });
            }
            return child.type === documents.types.text && !child.value;
        });
    }

    function elementToHtml(element, messages, options) {
        if (!options) {
            throw new Error("options not set");
        }
        var handler = elementConverters[element.type];
        if (handler) {
            return handler(element, messages, options);
        } else {
            return [];
        }
    }

    function convertParagraph(element, messages, options) {
        var paragraphForStyle = element;
        if (element.numbering && options && options.listLevel !== undefined &&
                String(options.listLevel) !== String(element.numbering.level)) {
            paragraphForStyle = _.extend({}, element, {
                numbering: _.extend({}, element.numbering, {
                    level: String(options.listLevel)
                })
            });
        }

        var htmlPath = htmlPathForParagraph(paragraphForStyle, messages);
        
        // Check if numbering has startOverride
        if (element.numbering && element.numbering.isOrdered && element.numbering.startOverride) {
            htmlPath = modifyHtmlPathForListContinuation(htmlPath, element.numbering.startOverride);
        } else if (options && options.listContinuation && options.listStartNumber && element.numbering && element.numbering.isOrdered) {
            // If this is a list continuation after interruption, we need to modify the HTML path
            htmlPath = modifyHtmlPathForListContinuation(htmlPath, options.listStartNumber);
        } else if (options && options.continuedListStartNumber && element.numbering && element.numbering.isOrdered) {
            // For consecutive items in a continued list, add the same start attribute so they merge
            htmlPath = modifyHtmlPathForListContinuation(htmlPath, options.continuedListStartNumber);
        } else if (options && options.forceNewList && element.numbering) {
            // Force a new list by making the ol/ul element fresh
            htmlPath = makeFreshList(htmlPath);
        }
        
        htmlPath = withNumberingClass(htmlPath, element.numbering);
        var cssAlignment = cssAlignmentFor(element.alignment);
        if (cssAlignment !== options.tableCellAlignment) {
            htmlPath = withParagraphAlignment(htmlPath, element.alignment);
        }

        return htmlPath.wrap(function() {
            var content = convertElements(element.children, messages, options);
            if (ignoreEmptyParagraphs) {
                return content;
            } else {
                return [Html.forceWrite].concat(content);
            }
        });
    }

    function withParagraphAlignment(path, alignment) {
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

    function convertRun(run, messages, options) {
        var nodes = function() {
            return convertElements(run.children, messages, options);
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
            return promises.attempt(function() {
                return convertImage(image, messages);
            }).caught(function(error) {
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

    function convertTable(element, messages, options) {
        return findHtmlPath(element, defaultTablePath).wrap(function() {
            return convertTableChildren(element, messages, options);
        });
    }

    function convertTableChildren(element, messages, options) {
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
                _.extend({}, options, {isTableHeader: false})
            );
        } else {
            var headRows = convertElements(
                element.children.slice(0, bodyIndex),
                messages,
                _.extend({}, options, {isTableHeader: true})
            );
            var bodyRows = convertElements(
                element.children.slice(bodyIndex),
                messages,
                _.extend({}, options, {isTableHeader: false})
            );
            children = [
                Html.freshElement("thead", {}, headRows),
                Html.freshElement("tbody", {}, bodyRows)
            ];
        }
        return [Html.forceWrite].concat(children);
    }

    function convertTableRow(element, messages, options) {
        var children = convertElements(element.children, messages, options);
        return [
            Html.freshElement("tr", {}, [Html.forceWrite].concat(children))
        ];
    }

    function convertTableCell(element, messages, options) {
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

    function convertCommentReference(reference, messages, options) {
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

    function convertComment(referencedComment, messages, options) {
        // TODO: remove duplication with note references

        var label = referencedComment.label;
        var comment = referencedComment.comment;
        var body = convertElements(comment.body, messages, options).concat([
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

    function convertBreak(element, messages, options) {
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
    
    function modifyHtmlPathForListContinuation(htmlPath, startNumber) {
        // We need to intercept the HTML path elements and add start attribute to ol elements
        if (htmlPath._elements) {
            var modifiedElements = htmlPath._elements.map(function(element) {
                if (element.tagName === "ol" || (element.tagNames && element.tagNames.ol)) {
                    // Create a new element with start attribute
                    return _.extend({}, element, {
                        attributes: _.extend({}, element.attributes, {
                            start: startNumber.toString()
                        })
                    });
                }
                return element;
            });
            
            return htmlPaths.elements(modifiedElements);
        }
        
        return htmlPath;
    }
    
    function makeFreshList(htmlPath) {
        // Make the list element (ol/ul) fresh to prevent merging with previous lists
        if (htmlPath._elements) {
            var modifiedElements = htmlPath._elements.map(function(element) {
                if (element.tagName === "ol" || element.tagName === "ul" ||
                    (element.tagNames && (element.tagNames.ol || element.tagNames.ul))) {
                    // Create a new element that's fresh
                    return _.extend({}, element, {
                        fresh: true
                    });
                }
                return element;
            });
            
            return htmlPaths.elements(modifiedElements);
        }
        
        return htmlPath;
    }

    var elementConverters = {
        "document": function(document, messages, options) {
            var children = convertElements(document.children, messages, options);
            var notes = noteReferences.map(function(noteReference) {
                return document.notes.resolve(noteReference);
            });
            var notesNodes = convertElements(notes, messages, options);
            return children.concat([
                Html.freshElement("ol", {}, notesNodes),
                Html.freshElement("dl", {}, flatMap(referencedComments, function(referencedComment) {
                    return convertComment(referencedComment, messages, options);
                }))
            ]);
        },
        "paragraph": convertParagraph,
        "run": convertRun,
        "text": function(element, messages, options) {
            return [Html.text(element.value)];
        },
        "tab": function(element, messages, options) {
            return [Html.text("\t")];
        },
        "hyperlink": function(element, messages, options) {
            var href = element.anchor ? "#" + htmlId(element.anchor) : element.href;
            var attributes = {href: href};
            if (element.targetFrame != null) {
                attributes.target = element.targetFrame;
            }

            var children = convertElements(element.children, messages, options);
            return [Html.nonFreshElement("a", attributes, children)];
        },
        "checkbox": function(element) {
            var attributes = {type: "checkbox"};
            if (element.checked) {
                attributes["checked"] = "checked";
            }
            return [Html.freshElement("input", attributes)];
        },
        "bookmarkStart": function(element, messages, options) {
            var anchor = Html.freshElement("a", {
                id: htmlId(element.name)
            }, [Html.forceWrite]);
            return [anchor];
        },
        "noteReference": function(element, messages, options) {
            noteReferences.push(element);
            var anchor = Html.freshElement("a", {
                href: "#" + noteHtmlId(element),
                id: noteRefHtmlId(element)
            }, [Html.text("[" + (noteNumber++) + "]")]);

            return [Html.freshElement("sup", {}, [anchor])];
        },
        "note": function(element, messages, options) {
            var children = convertElements(element.body, messages, options);
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
    return function(element, messages, options) {
        return [
            {
                type: "deferred",
                id: deferredId++,
                value: function() {
                    return func(element, messages, options);
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
