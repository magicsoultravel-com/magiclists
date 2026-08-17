/** @module {"owns":"multi-document element lookup for module popouts", "related":["sidebarModulePopout.js","sidebarModules.js"]} */

/** @type {Set<Document>} */
const extraDocuments = new Set();

export function registerAppDocument(doc) {
    if (doc && doc !== document) extraDocuments.add(doc);
}

export function unregisterAppDocument(doc) {
    extraDocuments.delete(doc);
}

/** Search the main document then any registered popout documents. */
export function getAppElementById(id) {
    if (!id) return null;
    const main = document.getElementById(id);
    if (main) return main;
    for (const doc of extraDocuments) {
        try {
            const el = doc.getElementById(id);
            if (el) return el;
        } catch {
            /* detached document */
        }
    }
    return null;
}

export function getAppDocumentForElement(el) {
    return el?.ownerDocument || document;
}

export function getAppBodyForElement(anchor) {
    return getAppDocumentForElement(anchor).body || document.body;
}

export function getAppWindowForElement(anchor) {
    return getAppDocumentForElement(anchor).defaultView || window;
}
