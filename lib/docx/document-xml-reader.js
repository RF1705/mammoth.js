exports.DocumentXmlReader = DocumentXmlReader;
exports._normaliseListParagraphs = normaliseListParagraphs;

var documents = require("../documents");
var Result = require("../results").Result;


function DocumentXmlReader(options) {
    var bodyReader = options.bodyReader;

    function convertXmlToDocument(element) {
        var body = element.first("w:body");

        if (body == null) {
            throw new Error("Could not find the body element: are you sure this is a docx file?");
        }

        var result = bodyReader.readXmlElements(body.children)
            .map(function(children) {
                return new documents.Document(normaliseListParagraphs(children), {
                    notes: options.notes,
                    comments: options.comments
                });
            });
        return new Result(result.value, result.messages);
    }

    return {
        convertXmlToDocument: convertXmlToDocument
    };
}

function normaliseListParagraphs(children) {
    var result = [];

    children.forEach(function(child) {
        if (isWhitespaceOnlyListParagraph(child)) {
            return;
        }

        var previous = result[result.length - 1];
        if (isListContinuationParagraph(child, previous)) {
            appendParagraphChildren(previous, child);
        } else {
            result.push(child);
        }
    });

    return result;
}

function isWhitespaceOnlyListParagraph(paragraph) {
    return isListParagraph(paragraph) &&
        !paragraph.numbering &&
        paragraphHasOnlyWhitespace(paragraph);
}

function isListContinuationParagraph(paragraph, previous) {
    return isListParagraph(paragraph) &&
        isListParagraph(previous) &&
        !paragraph.numbering &&
        !!previous.numbering &&
        !paragraphHasOnlyWhitespace(paragraph) &&
        hasMatchingIndent(paragraph, previous);
}

function isListParagraph(paragraph) {
    return paragraph && paragraph.type === documents.types.paragraph &&
        (isListParagraphStyle(paragraph.styleName) ||
            isListParagraphStyle(paragraph.styleId));
}

function isListParagraphStyle(value) {
    if (!value) {
        return false;
    }

    var normalised = value.toLowerCase().replace(/[^a-z]/g, "");
    return normalised === "listparagraph" || normalised === "listenabsatz";
}

function paragraphHasOnlyWhitespace(paragraph) {
    return !paragraph.children || paragraph.children.every(nodeHasOnlyWhitespace);
}

function nodeHasOnlyWhitespace(node) {
    if (node.type === documents.types.text) {
        return /^\s*$/.test(node.value || "");
    }
    if (node.children) {
        return node.children.every(nodeHasOnlyWhitespace);
    }
    return false;
}

function hasMatchingIndent(paragraph, previous) {
    var paragraphIndent = effectiveIndent(paragraph);
    var previousIndent = effectiveIndent(previous);

    return paragraphIndent !== null && previousIndent !== null &&
        Math.abs(paragraphIndent - previousIndent) <= 20;
}

function effectiveIndent(paragraph) {
    var paragraphIndent = numericIndent(paragraph.indent && paragraph.indent.start);
    if (paragraphIndent !== null) {
        return paragraphIndent;
    }

    return numericIndent(paragraph.numbering &&
        paragraph.numbering.indent && paragraph.numbering.indent.start);
}

function numericIndent(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
}

function appendParagraphChildren(previous, paragraph) {
    var separator = [];
    var previousText = paragraphText(previous);
    var paragraphTextValue = paragraphText(paragraph);

    if (previousText && paragraphTextValue &&
            !/\s$/.test(previousText) && !/^\s/.test(paragraphTextValue)) {
        separator = [documents.run([documents.text(" ")])];
    }

    previous.children = previous.children.concat(separator, paragraph.children || []);
}

function paragraphText(paragraph) {
    return (paragraph.children || []).map(nodeText).join("");
}

function nodeText(node) {
    if (node.type === documents.types.text) {
        return node.value || "";
    }
    if (node.children) {
        return node.children.map(nodeText).join("");
    }
    return "";
}
