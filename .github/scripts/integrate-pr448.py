from pathlib import Path
import re
import subprocess


def run(*args):
    subprocess.run(args, check=True)


# document-to-html.js: use PR #448 as the base for its list-continuation
# changes, then re-apply our numberingClassMap support on top.
run("git", "checkout", "--theirs", "lib/document-to-html.js")
path = Path("lib/document-to-html.js")
text = path.read_text()

text = text.replace(
    "options = _.extend({ignoreEmptyParagraphs: true}, options);",
    "options = _.extend({ignoreEmptyParagraphs: true, numberingClassMap: []}, options);",
    1,
)
text = text.replace(
    "var ignoreEmptyParagraphs = options.ignoreEmptyParagraphs;",
    "var ignoreEmptyParagraphs = options.ignoreEmptyParagraphs;\n"
    "    var numberingClassMap = options.numberingClassMap || [];",
    1,
)

needle = "        return htmlPath.wrap(function() {"
replacement = (
    "        htmlPath = withNumberingClass(htmlPath, element.numbering);\n\n"
    "        return htmlPath.wrap(function() {"
)
if needle not in text:
    raise SystemExit("Could not locate convertParagraph wrap")
text = text.replace(needle, replacement, 1)

helpers = r'''    function withNumberingClass(path, numbering) {
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

'''

marker = "    function htmlPathForParagraph(element, messages) {"
if marker not in text:
    raise SystemExit("Could not locate htmlPathForParagraph")
text = text.replace(marker, helpers + marker, 1)
path.write_text(text)


# numbering-xml.js: retain our current 1.12.1 implementation, including the
# numStyleLink cycle protection and numFmt/lvlText metadata, and add the
# w:startOverride support from PR #448.
run("git", "checkout", "--ours", "lib/docx/numbering-xml.js")
path = Path("lib/docx/numbering-xml.js")
text = path.read_text()

find_level = r'''    function findLevel(numId, level) {
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
    find_level,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Could not replace findLevel implementation")

read_nums = r'''function readNums(root) {
    var nums = {};
    root.getElementsByTagName("w:num").forEach(function(element) {
        var numId = element.attributes["w:numId"];
        var abstractNumId = element.first("w:abstractNumId").attributes["w:val"];
        var levelOverrides = {};

        element.getElementsByTagName("w:lvlOverride").forEach(function(overrideElement) {
            var level = overrideElement.attributes["w:ilvl"];
            var startOverrideElement = overrideElement.firstOrEmpty("w:startOverride");
            if (startOverrideElement.attributes["w:val"]) {
                levelOverrides[level] = {
                    startOverride: parseInt(startOverrideElement.attributes["w:val"], 10)
                };
            }
        });

        nums[numId] = {
            abstractNumId: abstractNumId,
            levelOverrides: Object.keys(levelOverrides).length > 0 ? levelOverrides : undefined
        };
    });
    return nums;
}
'''

text, count = re.subn(
    r"function readNums\(root\) \{.*?\n\}",
    read_nums.rstrip(),
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Could not replace readNums implementation")

if "<<<<<<<" in text or ">>>>>>>" in text or "\n=======" in text:
    raise SystemExit("Unresolved conflict markers remain")
path.write_text(text)
