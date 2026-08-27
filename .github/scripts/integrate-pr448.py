from pathlib import Path
import re

path = Path("lib/document-to-html.js")
text = path.read_text()

text = re.sub(
    r"<<<<<<< HEAD\n\s*var html = elementToHtml\(document, messages, \{\}\);\n=======\n\s*\n\s*var html = elementToHtml\(document, messages, \{listState: listState\}\);\n>>>>>>>[^\n]*",
    "        var html = elementToHtml(document, messages, {listState: listState});",
    text,
    count=1,
)

paragraph_prefix = '''    function convertParagraph(element, messages, options) {
        var htmlPath = htmlPathForParagraph(element, messages);

        if (element.numbering && element.numbering.isOrdered && element.numbering.startOverride) {
            htmlPath = modifyHtmlPathForListContinuation(htmlPath, element.numbering.startOverride);
        } else if (options && options.listContinuation && options.listStartNumber && element.numbering && element.numbering.isOrdered) {
            htmlPath = modifyHtmlPathForListContinuation(htmlPath, options.listStartNumber);
        } else if (options && options.continuedListStartNumber && element.numbering && element.numbering.isOrdered) {
            htmlPath = modifyHtmlPathForListContinuation(htmlPath, options.continuedListStartNumber);
        } else if (options && options.forceNewList && element.numbering) {
            htmlPath = makeFreshList(htmlPath);
        }

        htmlPath = withNumberingClass(htmlPath, element.numbering);

        return htmlPath.wrap(function() {'''

text, count = re.subn(
    r"    function convertParagraph\(element, messages, options\) \{.*?        return (?:path|htmlPath)\.wrap\(function\(\) \{",
    paragraph_prefix,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Could not resolve convertParagraph conflict")
if "<<<<<<<" in text or ">>>>>>>" in text or "\n=======" in text:
    raise SystemExit("Unresolved conflict markers remain in document-to-html.js")
path.write_text(text)

path = Path("lib/docx/numbering-xml.js")
text = path.read_text()

replacement = '''    function findLevel(numId, level) {
        return findLevelWithSeenNumIds(numId, level, {});
    }

    function findLevelWithSeenNumIds(numId, level, seenNumIds) {
        if (seenNumIds[numId]) {
            return null;
        }
        seenNumIds[numId] = true;

        var num = nums[numId];
        if (!num) {
            return null;
        }

        var abstractNum = abstractNums[num.abstractNumId];
        if (!abstractNum) {
            return null;
        }

        var resolvedLevel;
        if (abstractNum.numStyleLink == null) {
            resolvedLevel = abstractNums[num.abstractNumId].levels[level];
        } else {
            var style = styles.findNumberingStyleById(abstractNum.numStyleLink);
            resolvedLevel = findLevelWithSeenNumIds(style.numId, level, seenNumIds);
        }

        if (resolvedLevel && num.levelOverrides && num.levelOverrides[level]) {
            resolvedLevel = _.extend({}, resolvedLevel, num.levelOverrides[level]);
        }

        if (resolvedLevel) {
            resolvedLevel = _.extend({}, resolvedLevel, {numId: numId});
        }

        return resolvedLevel;
    }

'''

text, count = re.subn(
    r"    function findLevel\(numId, level\) \{.*?(?=    function findLevelByParagraphStyleId)",
    replacement,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Could not resolve numbering findLevel conflict")
if "<<<<<<<" in text or ">>>>>>>" in text or "\n=======" in text:
    raise SystemExit("Unresolved conflict markers remain in numbering-xml.js")
path.write_text(text)
