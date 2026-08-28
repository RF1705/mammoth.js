var _ = require("underscore");

exports.readNumberingXml = readNumberingXml;
exports.Numbering = Numbering;
exports.defaultNumbering = new Numbering({}, {});

function Numbering(nums, abstractNums, styles) {
    var allLevels = _.flatten(_.values(abstractNums).map(function(abstractNum) {
        return _.values(abstractNum.levels);
    }));

    var levelsByParagraphStyleId = _.indexBy(
        allLevels.filter(function(level) {
            return level.paragraphStyleId != null;
        }),
        "paragraphStyleId"
    );

    function findLevel(numId, level) {
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

        if (abstractNum.numStyleLink == null) {
            return abstractNums[num.abstractNumId].levels[level];
        } else {
            var style = styles.findNumberingStyleById(abstractNum.numStyleLink);
            return findLevelWithSeenNumIds(style.numId, level, seenNumIds);
        }
    }

    function findLevelByParagraphStyleId(styleId) {
        return levelsByParagraphStyleId[styleId] || null;
    }

    return {
        findLevel: findLevel,
        findLevelByParagraphStyleId: findLevelByParagraphStyleId
    };
}

function readNumberingXml(root, options) {
    if (!options || !options.styles) {
        throw new Error("styles is missing");
    }

    var abstractNums = readAbstractNums(root);
    var nums = readNums(root, abstractNums);
    return new Numbering(nums, abstractNums, options.styles);
}

function readAbstractNums(root) {
    var abstractNums = {};
    root.getElementsByTagName("w:abstractNum").forEach(function(element) {
        var id = element.attributes["w:abstractNumId"];
        abstractNums[id] = readAbstractNum(element);
    });
    return abstractNums;
}

function readAbstractNum(element) {
    var levels = {};

    // Some malformed documents define numbering levels without an index, and
    // reference the numbering using a w:numPr element without a w:ilvl child.
    // To handle such cases, we assume a level of 0 as a fallback.
    var levelWithoutIndex = null;

    element.getElementsByTagName("w:lvl").forEach(function(levelElement) {
        var levelIndex = levelElement.attributes["w:ilvl"];
        var numFmt = levelElement.firstOrEmpty("w:numFmt").attributes["w:val"];
        var levelText = levelElement.firstOrEmpty("w:lvlText").attributes["w:val"];
        var isOrdered = numFmt !== "bullet";
        var paragraphStyleId = levelElement.firstOrEmpty("w:pStyle").attributes["w:val"];
        var level = {
            isOrdered: isOrdered,
            level: levelIndex === undefined ? "0" : levelIndex,
            paragraphStyleId: paragraphStyleId,
            numFmt: numFmt,
            levelText: levelText,
            indent: readLevelIndent(levelElement.firstOrEmpty("w:pPr").firstOrEmpty("w:ind"))
        };

        if (levelIndex === undefined) {
            levelWithoutIndex = level;
        } else {
            levels[levelIndex] = level;
        }
    });

    if (levelWithoutIndex !== null && levels[levelWithoutIndex.level] === undefined) {
        levels[levelWithoutIndex.level] = levelWithoutIndex;
    }

    var numStyleLink = element.firstOrEmpty("w:numStyleLink").attributes["w:val"];

    return {levels: levels, numStyleLink: numStyleLink};
}

function readLevelIndent(element) {
    return {
        start: element.attributes["w:start"] || element.attributes["w:left"],
        end: element.attributes["w:end"] || element.attributes["w:right"],
        firstLine: element.attributes["w:firstLine"],
        hanging: element.attributes["w:hanging"]
    };
}

function readNums(root) {
    var nums = {};
    root.getElementsByTagName("w:num").forEach(function(element) {
        var numId = element.attributes["w:numId"];
        var abstractNumId = element.first("w:abstractNumId").attributes["w:val"];
        nums[numId] = {abstractNumId: abstractNumId};
    });
    return nums;
}
