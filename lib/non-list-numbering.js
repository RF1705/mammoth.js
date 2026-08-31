var _ = require("underscore");

var documents = require("./documents");

exports.normalise = normalise;


function normalise(element, styleMap) {
    if (!element) {
        return element;
    }

    var result = element;
    if (element.children) {
        result = _.extend({}, element, {
            children: element.children.map(function(child) {
                return normalise(child, styleMap);
            })
        });
    }

    if (result.type === documents.types.paragraph && result.numbering &&
            !rendersAsList(result, styleMap || [])) {
        result = _.extend({}, result, {numbering: null});
    }

    return result;
}

function rendersAsList(paragraph, styleMap) {
    var style = findStyle(paragraph, styleMap);
    return style && pathContainsList(style.to);
}

function findStyle(element, styleMap) {
    for (var i = 0; i < styleMap.length; i++) {
        if (styleMap[i].from.matches(element)) {
            return styleMap[i];
        }
    }
    return null;
}

function pathContainsList(path) {
    return path && path._elements && path._elements.some(function(element) {
        return element.tagName === "ol" || element.tagName === "ul" ||
            (element.tagNames && (element.tagNames.ol || element.tagNames.ul));
    });
}
