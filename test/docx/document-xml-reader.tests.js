var assert = require("assert");

var documents = require("../../lib/documents");
var documentXmlReader = require("../../lib/docx/document-xml-reader");
var DocumentXmlReader = documentXmlReader.DocumentXmlReader;
var normaliseListParagraphs = documentXmlReader._normaliseListParagraphs;
var xml = require("../../lib/xml");
var test = require("../test")(module);
var createBodyReaderForTests = require("./testing").createBodyReaderForTests;

test("when body element is present then body is read", function() {
    var bodyReader = createBodyReaderForTests({});
    var documentXmlReader = new DocumentXmlReader({
        bodyReader: bodyReader
    });
    var textXml = xml.element("w:t", {}, [xml.text("Hello!")]);
    var runXml = xml.element("w:r", {}, [textXml]);
    var paragraphXml = xml.element("w:p", {}, [runXml]);
    var bodyXml = xml.element("w:body", {}, [paragraphXml]);
    var documentXml = xml.element("w:document", {}, [bodyXml]);

    var result = documentXmlReader.convertXmlToDocument(documentXml);

    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.value, documents.document(
        [documents.paragraph([documents.run([documents.text("Hello!")])])],
        {}
    ));
});

test("when body element is not present then error is thrown", function() {
    var bodyReader = createBodyReaderForTests({});
    var documentXmlReader = new DocumentXmlReader({
        bodyReader: bodyReader
    });
    var paragraphXml = xml.element("w:p", {}, []);
    var bodyXml = xml.element("w:body2", {}, [paragraphXml]);
    var documentXml = xml.element("w:document", {}, [bodyXml]);

    assert.throws(function() {
        documentXmlReader.convertXmlToDocument(documentXml);
    }, /Could not find the body element: are you sure this is a docx file?/);
});

test("whitespace-only List Paragraphs are removed before conversion", function() {
    var parent = listParagraph("Parent", {
        isOrdered: true,
        level: "0",
        numId: "9"
    }, {start: "360"});
    var whitespace = listParagraph(" ", null, {start: "360"});
    var nested = listParagraph("Nested", {
        isOrdered: true,
        level: "1",
        numId: "9"
    }, {start: "1080"});

    var result = normaliseListParagraphs([parent, whitespace, nested]);

    assert.deepEqual(result, [parent, nested]);
});

test("unnumbered List Paragraph with matching indent continues previous list item", function() {
    var previous = listParagraph("The provision applies until ", {
        isOrdered: false,
        level: "1",
        numId: "11"
    }, {start: "567"});
    var continuation = listParagraph("31 December.", null, {start: "567"});

    var result = normaliseListParagraphs([previous, continuation]);

    assert.equal(result.length, 1);
    assert.equal(paragraphText(result[0]), "The provision applies until 31 December.");
});

function listParagraph(text, numbering, indent) {
    return documents.paragraph([
        documents.run([documents.text(text)])
    ], {
        styleId: "Listenabsatz",
        styleName: "List Paragraph",
        numbering: numbering,
        indent: indent
    });
}

function paragraphText(paragraph) {
    return paragraph.children.map(function(run) {
        return (run.children || []).map(function(child) {
            return child.value || "";
        }).join("");
    }).join("");
}
