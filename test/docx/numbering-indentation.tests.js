var assert = require("assert");

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
