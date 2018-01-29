"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const highlight = require("atom-highlight");
const pandocHelper = require("./pandoc-helper");
const markdownIt = require("./markdown-it-helper");
const extension_helper_1 = require("./extension-helper");
const imageWatcher = require("./image-watch-helper");
const util_1 = require("./util");
const { resourcePath } = atom.getLoadSettings();
const packagePath = path.dirname(__dirname);
async function toDOMFragment(text, filePath, _grammar, renderLaTeX, callback) {
    return render(text, filePath, renderLaTeX, false, function (error, html) {
        if (error !== null) {
            return callback(error);
        }
        const template = document.createElement('template');
        template.innerHTML = html;
        const domFragment = template.content.cloneNode(true);
        return callback(null, domFragment);
    });
}
exports.toDOMFragment = toDOMFragment;
async function toHTML(text, filePath, grammar, renderLaTeX, copyHTMLFlag, callback) {
    if (text === null) {
        text = '';
    }
    return render(text, filePath, renderLaTeX, copyHTMLFlag, function (error, html) {
        let defaultCodeLanguage;
        if (error !== null) {
            callback(error, '');
        }
        if ((grammar && grammar.scopeName) === 'source.litcoffee') {
            defaultCodeLanguage = 'coffee';
        }
        if (!atom.config.get('markdown-preview-plus.enablePandoc') ||
            !atom.config.get('markdown-preview-plus.useNativePandocCodeStyles')) {
            html = tokenizeCodeBlocks(html, defaultCodeLanguage);
        }
        callback(null, html);
    });
}
exports.toHTML = toHTML;
async function render(text, filePath, renderLaTeX, copyHTMLFlag, callback) {
    text = text.replace(/^\s*<!doctype(\s+.*)?>\s*/i, '');
    const callbackFunction = async function (error, html) {
        if (error !== null) {
            callback(error, '');
        }
        html = sanitize(html);
        html = await resolveImagePaths(html, filePath, copyHTMLFlag);
        return callback(null, html.trim());
    };
    if (atom.config.get('markdown-preview-plus.enablePandoc')) {
        return pandocHelper.renderPandoc(text, filePath, renderLaTeX, callbackFunction);
    }
    else {
        return callbackFunction(null, markdownIt.render(text, renderLaTeX));
    }
}
function sanitize(html) {
    const doc = document.createElement('div');
    doc.innerHTML = html;
    doc.querySelectorAll("script:not([type^='math/tex'])").forEach((elem) => {
        elem.remove();
    });
    const attributesToRemove = [
        'onabort',
        'onblur',
        'onchange',
        'onclick',
        'ondbclick',
        'onerror',
        'onfocus',
        'onkeydown',
        'onkeypress',
        'onkeyup',
        'onload',
        'onmousedown',
        'onmousemove',
        'onmouseover',
        'onmouseout',
        'onmouseup',
        'onreset',
        'onresize',
        'onscroll',
        'onselect',
        'onsubmit',
        'onunload',
    ];
    doc.querySelectorAll('*').forEach((elem) => attributesToRemove.map((attribute) => {
        elem.removeAttribute(attribute);
    }));
    return doc.innerHTML;
}
async function resolveImagePaths(html, filePath, copyHTMLFlag) {
    const [rootDirectory] = atom.project.relativizePath(filePath || '');
    const doc = document.createElement('div');
    doc.innerHTML = html;
    await Promise.all(Array.from(doc.querySelectorAll('img')).map(async function (img) {
        let src = img.getAttribute('src');
        if (src) {
            if (!atom.config.get('markdown-preview-plus.enablePandoc')) {
                src = markdownIt.decode(src);
            }
            if (src.match(/^(https?|atom|data):/)) {
                return;
            }
            if (src.startsWith(process.resourcesPath)) {
                return;
            }
            if (src.startsWith(resourcePath)) {
                return;
            }
            if (src.startsWith(packagePath)) {
                return;
            }
            if (src[0] === '/') {
                if (!util_1.isFileSync(src)) {
                    try {
                        if (rootDirectory !== null) {
                            src = path.join(rootDirectory, src.substring(1));
                        }
                    }
                    catch (e) {
                    }
                }
            }
            else if (filePath) {
                src = path.resolve(path.dirname(filePath), src);
            }
            if (!copyHTMLFlag) {
                const v = await imageWatcher.getVersion(src, filePath);
                if (v) {
                    src = `${src}?v=${v}`;
                }
            }
            img.src = src;
        }
        return;
    }));
    return doc.innerHTML;
}
function convertCodeBlocksToAtomEditors(domFragment, defaultLanguage = 'text') {
    const fontFamily = atom.config.get('editor.fontFamily');
    if (fontFamily) {
        for (const codeElement of Array.from(domFragment.querySelectorAll('code'))) {
            codeElement.style.fontFamily = fontFamily;
        }
    }
    for (const preElement of Array.from(domFragment.querySelectorAll('pre'))) {
        const codeBlock = preElement.firstElementChild !== null
            ? preElement.firstElementChild
            : preElement;
        const cbClass = codeBlock.className;
        const fenceName = cbClass
            ? cbClass.replace(/^(lang-|sourceCode )/, '')
            : defaultLanguage;
        const editorElement = document.createElement('atom-text-editor');
        editorElement.setAttributeNode(document.createAttribute('gutter-hidden'));
        editorElement.removeAttribute('tabindex');
        preElement.parentElement.replaceChild(editorElement, preElement);
        const editor = editorElement.getModel();
        if (editor.cursorLineDecorations != null) {
            for (const cursorLineDecoration of editor.cursorLineDecorations) {
                cursorLineDecoration.destroy();
            }
        }
        editor.setText(codeBlock.textContent.replace(/\n$/, ''));
        const grammar = atom.grammars.grammarForScopeName(extension_helper_1.scopeForFenceName(fenceName));
        if (grammar) {
            editor.setGrammar(grammar);
            editorElement.dataset.grammar = grammar.scopeName.replace(/\./g, ' ');
        }
    }
    return domFragment;
}
exports.convertCodeBlocksToAtomEditors = convertCodeBlocksToAtomEditors;
function tokenizeCodeBlocks(html, defaultLanguage = 'text') {
    const doc = document.createElement('div');
    doc.innerHTML = html;
    const fontFamily = atom.config.get('editor.fontFamily');
    if (fontFamily) {
        doc
            .querySelectorAll('code')
            .forEach((code) => (code.style.fontFamily = fontFamily || null));
    }
    doc.querySelectorAll('pre').forEach(function (preElement) {
        const codeBlock = preElement.firstElementChild;
        const fenceName = codeBlock.className.replace(/^(lang-|sourceCode )/, '') || defaultLanguage;
        const highlightedHtml = highlight({
            fileContents: codeBlock.innerText,
            scopeName: extension_helper_1.scopeForFenceName(fenceName),
            nbsp: false,
            lineDivs: false,
            editorDiv: true,
            editorDivTag: 'pre',
            editorDivClass: fenceName
                ? `editor-colors lang-${fenceName}`
                : 'editor-colors',
        });
        preElement.outerHTML = highlightedHtml;
    });
    return doc.innerHTML;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVuZGVyZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvcmVuZGVyZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFPQSw2QkFBNkI7QUFDN0IsNENBQTRDO0FBQzVDLGdEQUFnRDtBQUNoRCxtREFBbUQ7QUFDbkQseURBQXNEO0FBQ3RELHFEQUFxRDtBQUVyRCxpQ0FBbUM7QUFFbkMsTUFBTSxFQUFFLFlBQVksRUFBRSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtBQUMvQyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0FBRXBDLEtBQUssd0JBQ1YsSUFBWSxFQUNaLFFBQTRCLEVBQzVCLFFBQWEsRUFDYixXQUFvQixFQUNwQixRQUF3RDtJQUV4RCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxVQUNoRCxLQUFtQixFQUNuQixJQUFhO1FBRWIsRUFBRSxDQUFDLENBQUMsS0FBSyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDbkIsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN4QixDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNuRCxRQUFRLENBQUMsU0FBUyxHQUFHLElBQUssQ0FBQTtRQUMxQixNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUVwRCxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQTtJQUNwQyxDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUM7QUFyQkQsc0NBcUJDO0FBRU0sS0FBSyxpQkFDVixJQUFtQixFQUNuQixRQUE0QixFQUM1QixPQUE0QixFQUM1QixXQUFvQixFQUNwQixZQUFxQixFQUNyQixRQUFx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LEVBQUUsS0FBSztZQUNYLFFBQVEsRUFBRSxLQUFLO1lBQ2YsU0FBUyxFQUFFLElBQUk7WUFDZixZQUFZLEVBQUUsS0FBSztZQUVuQixjQUFjLEVBQUUsU0FBUztnQkFDdkIsQ0FBQyxDQUFDLHNCQUFzQixTQUFTLEVBQUU7Z0JBQ25DLENBQUMsQ0FBQyxlQUFlO1NBQ3BCLENBQUMsQ0FBQTtRQUVGLFVBQVUsQ0FBQyxTQUFTLEdBQUcsZUFBZSxDQUFBO0lBQ3hDLENBQUMsQ0FBQyxDQUFBO0lBRUYsTUFBTSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUE7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBkZWNhZmZlaW5hdGUgc3VnZ2VzdGlvbnM6XG4gKiBEUzEwMjogUmVtb3ZlIHVubmVjZXNzYXJ5IGNvZGUgY3JlYXRlZCBiZWNhdXNlIG9mIGltcGxpY2l0IHJldHVybnNcbiAqIERTMTA0OiBBdm9pZCBpbmxpbmUgYXNzaWdubWVudHNcbiAqIERTMjA3OiBDb25zaWRlciBzaG9ydGVyIHZhcmlhdGlvbnMgb2YgbnVsbCBjaGVja3NcbiAqIEZ1bGwgZG9jczogaHR0cHM6Ly9naXRodWIuY29tL2RlY2FmZmVpbmF0ZS9kZWNhZmZlaW5hdGUvYmxvYi9tYXN0ZXIvZG9jcy9zdWdnZXN0aW9ucy5tZFxuICovXG5pbXBvcnQgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuaW1wb3J0IGhpZ2hsaWdodCA9IHJlcXVpcmUoJ2F0b20taGlnaGxpZ2h0JylcbmltcG9ydCBwYW5kb2NIZWxwZXIgPSByZXF1aXJlKCcuL3BhbmRvYy1oZWxwZXInKVxuaW1wb3J0IG1hcmtkb3duSXQgPSByZXF1aXJlKCcuL21hcmtkb3duLWl0LWhlbHBlcicpIC8vIERlZmVyIHVudGlsIHVzZWRcbmltcG9ydCB7IHNjb3BlRm9yRmVuY2VOYW1lIH0gZnJvbSAnLi9leHRlbnNpb24taGVscGVyJ1xuaW1wb3J0IGltYWdlV2F0Y2hlciA9IHJlcXVpcmUoJy4vaW1hZ2Utd2F0Y2gtaGVscGVyJylcbmltcG9ydCB7IEdyYW1tYXIsIFRleHRFZGl0b3JFbGVtZW50IH0gZnJvbSAnYXRvbSdcbmltcG9ydCB7IGlzRmlsZVN5bmMgfSBmcm9tICcuL3V0aWwnXG5cbmNvbnN0IHsgcmVzb3VyY2VQYXRoIH0gPSBhdG9tLmdldExvYWRTZXR0aW5ncygpXG5jb25zdCBwYWNrYWdlUGF0aCA9IHBhdGguZGlybmFtZShfX2Rpcm5hbWUpXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB0b0RPTUZyYWdtZW50PFQ+KFxuICB0ZXh0OiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gIF9ncmFtbWFyOiBhbnksXG4gIHJlbmRlckxhVGVYOiBib29sZWFuLFxuICBjYWxsYmFjazogKGVycm9yOiBFcnJvciB8IG51bGwsIGRvbUZyYWdtZW50PzogTm9kZSkgPT4gVCxcbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gcmVuZGVyKHRleHQsIGZpbGVQYXRoLCByZW5kZXJMYVRlWCwgZmFsc2UsIGZ1bmN0aW9uKFxuICAgIGVycm9yOiBFcnJvciB8IG51bGwsXG4gICAgaHRtbD86IHN0cmluZyxcbiAgKSB7XG4gICAgaWYgKGVycm9yICE9PSBudWxsKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpXG4gICAgfVxuXG4gICAgY29uc3QgdGVtcGxhdGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpXG4gICAgdGVtcGxhdGUuaW5uZXJIVE1MID0gaHRtbCFcbiAgICBjb25zdCBkb21GcmFnbWVudCA9IHRlbXBsYXRlLmNvbnRlbnQuY2xvbmVOb2RlKHRydWUpXG5cbiAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwgZG9tRnJhZ21lbnQpXG4gIH0pXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB0b0hUTUwoXG4gIHRleHQ6IHN0cmluZyB8IG51bGwsXG4gIGZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gIGdyYW1tYXI6IEdyYW1tYXIgfCB1bmRlZmluZWQsXG4gIHJlbmRlckxhVGVYOiBib29sZWFuLFxuICBjb3B5SFRNTEZsYWc6IGJvb2xlYW4sXG4gIGNhbGxiYWNrOiAoZXJyb3I6IEVycm9yIHwgbnVsbCwgaHRtbDogc3RyaW5nKSA9PiB2b2lkLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmICh0ZXh0ID09PSBudWxsKSB7XG4gICAgdGV4dCA9ICcnXG4gIH1cbiAgcmV0dXJuIHJlbmRlcih0ZXh0LCBmaWxlUGF0aCwgcmVuZGVyTGFUZVgsIGNvcHlIVE1MRmxhZywgZnVuY3Rpb24oXG4gICAgZXJyb3IsXG4gICAgaHRtbCxcbiAgKSB7XG4gICAgbGV0IGRlZmF1bHRDb2RlTGFuZ3VhZ2U6IHN0cmluZyB8IHVuZGVmaW5lZFxuICAgIGlmIChlcnJvciAhPT0gbnVsbCkge1xuICAgICAgY2FsbGJhY2soZXJyb3IsICcnKVxuICAgIH1cbiAgICAvLyBEZWZhdWx0IGNvZGUgYmxvY2tzIHRvIGJlIGNvZmZlZSBpbiBMaXRlcmF0ZSBDb2ZmZWVTY3JpcHQgZmlsZXNcbiAgICBpZiAoKGdyYW1tYXIgJiYgZ3JhbW1hci5zY29wZU5hbWUpID09PSAnc291cmNlLmxpdGNvZmZlZScpIHtcbiAgICAgIGRlZmF1bHRDb2RlTGFuZ3VhZ2UgPSAnY29mZmVlJ1xuICAgIH1cbiAgICBpZiAoXG4gICAgICAhYXRvbS5jb25maWcuZ2V0KCdtYXJrZG93bi1wcmV2aWV3LXBsdXMuZW5hYmxlUGFuZG9jJykgfHxcbiAgICAgICFhdG9tLmNvbmZpZy5nZXQoJ21hcmtkb3duLXByZXZpZXctcGx1cy51c2VOYXRpdmVQYW5kb2NDb2RlU3R5bGVzJylcbiAgICApIHtcbiAgICAgIGh0bWwgPSB0b2tlbml6ZUNvZGVCbG9ja3MoaHRtbCwgZGVmYXVsdENvZGVMYW5ndWFnZSlcbiAgICB9XG4gICAgY2FsbGJhY2sobnVsbCwgaHRtbClcbiAgfSlcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVuZGVyPFQ+KFxuICB0ZXh0OiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gIHJlbmRlckxhVGVYOiBib29sZWFuLFxuICBjb3B5SFRNTEZsYWc6IGJvb2xlYW4sXG4gIGNhbGxiYWNrOiAoZXJyb3I6IEVycm9yIHwgbnVsbCwgaHRtbDogc3RyaW5nKSA9PiBULFxuKTogUHJvbWlzZTxUPiB7XG4gIC8vIFJlbW92ZSB0aGUgPCFkb2N0eXBlPiBzaW5jZSBvdGhlcndpc2UgbWFya2VkIHdpbGwgZXNjYXBlIGl0XG4gIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9jaGpqL21hcmtlZC9pc3N1ZXMvMzU0XG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL15cXHMqPCFkb2N0eXBlKFxccysuKik/PlxccyovaSwgJycpXG5cbiAgY29uc3QgY2FsbGJhY2tGdW5jdGlvbiA9IGFzeW5jIGZ1bmN0aW9uKGVycm9yOiBFcnJvciB8IG51bGwsIGh0bWw6IHN0cmluZykge1xuICAgIGlmIChlcnJvciAhPT0gbnVsbCkge1xuICAgICAgY2FsbGJhY2soZXJyb3IsICcnKVxuICAgIH1cbiAgICBodG1sID0gc2FuaXRpemUoaHRtbClcbiAgICBodG1sID0gYXdhaXQgcmVzb2x2ZUltYWdlUGF0aHMoaHRtbCwgZmlsZVBhdGgsIGNvcHlIVE1MRmxhZylcbiAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwgaHRtbC50cmltKCkpXG4gIH1cblxuICBpZiAoYXRvbS5jb25maWcuZ2V0KCdtYXJrZG93bi1wcmV2aWV3LXBsdXMuZW5hYmxlUGFuZG9jJykpIHtcbiAgICByZXR1cm4gcGFuZG9jSGVscGVyLnJlbmRlclBhbmRvYyhcbiAgICAgIHRleHQsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIHJlbmRlckxhVGVYLFxuICAgICAgY2FsbGJhY2tGdW5jdGlvbixcbiAgICApXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrRnVuY3Rpb24obnVsbCwgbWFya2Rvd25JdC5yZW5kZXIodGV4dCwgcmVuZGVyTGFUZVgpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHNhbml0aXplKGh0bWw6IHN0cmluZykge1xuICBjb25zdCBkb2MgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKVxuICBkb2MuaW5uZXJIVE1MID0gaHRtbFxuICAvLyBEbyBub3QgcmVtb3ZlIE1hdGhKYXggc2NyaXB0IGRlbGltaXRlZCBibG9ja3NcbiAgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoXCJzY3JpcHQ6bm90KFt0eXBlXj0nbWF0aC90ZXgnXSlcIikuZm9yRWFjaCgoZWxlbSkgPT4ge1xuICAgIGVsZW0ucmVtb3ZlKClcbiAgfSlcbiAgY29uc3QgYXR0cmlidXRlc1RvUmVtb3ZlID0gW1xuICAgICdvbmFib3J0JyxcbiAgICAnb25ibHVyJyxcbiAgICAnb25jaGFuZ2UnLFxuICAgICdvbmNsaWNrJyxcbiAgICAnb25kYmNsaWNrJyxcbiAgICAnb25lcnJvcicsXG4gICAgJ29uZm9jdXMnLFxuICAgICdvbmtleWRvd24nLFxuICAgICdvbmtleXByZXNzJyxcbiAgICAnb25rZXl1cCcsXG4gICAgJ29ubG9hZCcsXG4gICAgJ29ubW91c2Vkb3duJyxcbiAgICAnb25tb3VzZW1vdmUnLFxuICAgICdvbm1vdXNlb3ZlcicsXG4gICAgJ29ubW91c2VvdXQnLFxuICAgICdvbm1vdXNldXAnLFxuICAgICdvbnJlc2V0JyxcbiAgICAnb25yZXNpemUnLFxuICAgICdvbnNjcm9sbCcsXG4gICAgJ29uc2VsZWN0JyxcbiAgICAnb25zdWJtaXQnLFxuICAgICdvbnVubG9hZCcsXG4gIF1cbiAgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoJyonKS5mb3JFYWNoKChlbGVtKSA9PlxuICAgIGF0dHJpYnV0ZXNUb1JlbW92ZS5tYXAoKGF0dHJpYnV0ZSkgPT4ge1xuICAgICAgZWxlbS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlKVxuICAgIH0pLFxuICApXG4gIHJldHVybiBkb2MuaW5uZXJIVE1MXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVJbWFnZVBhdGhzKFxuICBodG1sOiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gIGNvcHlIVE1MRmxhZzogYm9vbGVhbixcbikge1xuICBjb25zdCBbcm9vdERpcmVjdG9yeV0gPSBhdG9tLnByb2plY3QucmVsYXRpdml6ZVBhdGgoZmlsZVBhdGggfHwgJycpXG4gIGNvbnN0IGRvYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gIGRvYy5pbm5lckhUTUwgPSBodG1sXG4gIGF3YWl0IFByb21pc2UuYWxsKFxuICAgIEFycmF5LmZyb20oZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoJ2ltZycpKS5tYXAoYXN5bmMgZnVuY3Rpb24oaW1nKSB7XG4gICAgICBsZXQgc3JjID0gaW1nLmdldEF0dHJpYnV0ZSgnc3JjJylcbiAgICAgIGlmIChzcmMpIHtcbiAgICAgICAgaWYgKCFhdG9tLmNvbmZpZy5nZXQoJ21hcmtkb3duLXByZXZpZXctcGx1cy5lbmFibGVQYW5kb2MnKSkge1xuICAgICAgICAgIHNyYyA9IG1hcmtkb3duSXQuZGVjb2RlKHNyYylcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChzcmMubWF0Y2goL14oaHR0cHM/fGF0b218ZGF0YSk6LykpIHtcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIGlmIChzcmMuc3RhcnRzV2l0aChwcm9jZXNzLnJlc291cmNlc1BhdGggYXMgc3RyaW5nKSkge1xuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICAgIGlmIChzcmMuc3RhcnRzV2l0aChyZXNvdXJjZVBhdGgpKSB7XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNyYy5zdGFydHNXaXRoKHBhY2thZ2VQYXRoKSkge1xuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHNyY1swXSA9PT0gJy8nKSB7XG4gICAgICAgICAgaWYgKCFpc0ZpbGVTeW5jKHNyYykpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGlmIChyb290RGlyZWN0b3J5ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgc3JjID0gcGF0aC5qb2luKHJvb3REaXJlY3RvcnksIHNyYy5zdWJzdHJpbmcoMSkpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgLy8gbm9vcFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgIHNyYyA9IHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUoZmlsZVBhdGgpLCBzcmMpXG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgbW9zdCByZWNlbnQgdmVyc2lvbiBvZiBpbWFnZVxuICAgICAgICBpZiAoIWNvcHlIVE1MRmxhZykge1xuICAgICAgICAgIGNvbnN0IHYgPSBhd2FpdCBpbWFnZVdhdGNoZXIuZ2V0VmVyc2lvbihzcmMsIGZpbGVQYXRoKVxuICAgICAgICAgIGlmICh2KSB7XG4gICAgICAgICAgICBzcmMgPSBgJHtzcmN9P3Y9JHt2fWBcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpbWcuc3JjID0gc3JjXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9KSxcbiAgKVxuXG4gIHJldHVybiBkb2MuaW5uZXJIVE1MXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0Q29kZUJsb2Nrc1RvQXRvbUVkaXRvcnMoXG4gIGRvbUZyYWdtZW50OiBFbGVtZW50LFxuICBkZWZhdWx0TGFuZ3VhZ2U6IHN0cmluZyA9ICd0ZXh0Jyxcbikge1xuICBjb25zdCBmb250RmFtaWx5ID0gYXRvbS5jb25maWcuZ2V0KCdlZGl0b3IuZm9udEZhbWlseScpXG4gIGlmIChmb250RmFtaWx5KSB7XG4gICAgZm9yIChjb25zdCBjb2RlRWxlbWVudCBvZiBBcnJheS5mcm9tKFxuICAgICAgZG9tRnJhZ21lbnQucXVlcnlTZWxlY3RvckFsbCgnY29kZScpLFxuICAgICkpIHtcbiAgICAgIGNvZGVFbGVtZW50LnN0eWxlLmZvbnRGYW1pbHkgPSBmb250RmFtaWx5XG4gICAgfVxuICB9XG5cbiAgZm9yIChjb25zdCBwcmVFbGVtZW50IG9mIEFycmF5LmZyb20oZG9tRnJhZ21lbnQucXVlcnlTZWxlY3RvckFsbCgncHJlJykpKSB7XG4gICAgY29uc3QgY29kZUJsb2NrID1cbiAgICAgIHByZUVsZW1lbnQuZmlyc3RFbGVtZW50Q2hpbGQgIT09IG51bGxcbiAgICAgICAgPyBwcmVFbGVtZW50LmZpcnN0RWxlbWVudENoaWxkXG4gICAgICAgIDogcHJlRWxlbWVudFxuICAgIGNvbnN0IGNiQ2xhc3MgPSBjb2RlQmxvY2suY2xhc3NOYW1lXG4gICAgY29uc3QgZmVuY2VOYW1lID0gY2JDbGFzc1xuICAgICAgPyBjYkNsYXNzLnJlcGxhY2UoL14obGFuZy18c291cmNlQ29kZSApLywgJycpXG4gICAgICA6IGRlZmF1bHRMYW5ndWFnZVxuXG4gICAgY29uc3QgZWRpdG9yRWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXG4gICAgICAnYXRvbS10ZXh0LWVkaXRvcicsXG4gICAgKSBhcyBUZXh0RWRpdG9yRWxlbWVudFxuICAgIGVkaXRvckVsZW1lbnQuc2V0QXR0cmlidXRlTm9kZShkb2N1bWVudC5jcmVhdGVBdHRyaWJ1dGUoJ2d1dHRlci1oaWRkZW4nKSlcbiAgICBlZGl0b3JFbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSgndGFiaW5kZXgnKSAvLyBtYWtlIHJlYWQtb25seVxuXG4gICAgcHJlRWxlbWVudC5wYXJlbnRFbGVtZW50IS5yZXBsYWNlQ2hpbGQoZWRpdG9yRWxlbWVudCwgcHJlRWxlbWVudClcblxuICAgIGNvbnN0IGVkaXRvciA9IGVkaXRvckVsZW1lbnQuZ2V0TW9kZWwoKVxuICAgIC8vIHJlbW92ZSB0aGUgZGVmYXVsdCBzZWxlY3Rpb24gb2YgYSBsaW5lIGluIGVhY2ggZWRpdG9yXG4gICAgaWYgKGVkaXRvci5jdXJzb3JMaW5lRGVjb3JhdGlvbnMgIT0gbnVsbCkge1xuICAgICAgZm9yIChjb25zdCBjdXJzb3JMaW5lRGVjb3JhdGlvbiBvZiBlZGl0b3IuY3Vyc29yTGluZURlY29yYXRpb25zKSB7XG4gICAgICAgIGN1cnNvckxpbmVEZWNvcmF0aW9uLmRlc3Ryb3koKVxuICAgICAgfVxuICAgIH1cblxuICAgIGVkaXRvci5zZXRUZXh0KGNvZGVCbG9jay50ZXh0Q29udGVudCEucmVwbGFjZSgvXFxuJC8sICcnKSlcbiAgICBjb25zdCBncmFtbWFyID0gYXRvbS5ncmFtbWFycy5ncmFtbWFyRm9yU2NvcGVOYW1lKFxuICAgICAgc2NvcGVGb3JGZW5jZU5hbWUoZmVuY2VOYW1lKSxcbiAgICApXG4gICAgaWYgKGdyYW1tYXIpIHtcbiAgICAgIGVkaXRvci5zZXRHcmFtbWFyKGdyYW1tYXIpXG4gICAgICBlZGl0b3JFbGVtZW50LmRhdGFzZXQuZ3JhbW1hciA9IGdyYW1tYXIuc2NvcGVOYW1lLnJlcGxhY2UoL1xcLi9nLCAnICcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRvbUZyYWdtZW50XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplQ29kZUJsb2NrcyhodG1sOiBzdHJpbmcsIGRlZmF1bHRMYW5ndWFnZTogc3RyaW5nID0gJ3RleHQnKSB7XG4gIGNvbnN0IGRvYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gIGRvYy5pbm5lckhUTUwgPSBodG1sXG5cbiAgY29uc3QgZm9udEZhbWlseSA9IGF0b20uY29uZmlnLmdldCgnZWRpdG9yLmZvbnRGYW1pbHknKVxuICBpZiAoZm9udEZhbWlseSkge1xuICAgIGRvY1xuICAgICAgLnF1ZXJ5U2VsZWN0b3JBbGwoJ2NvZGUnKVxuICAgICAgLmZvckVhY2goKGNvZGUpID0+IChjb2RlLnN0eWxlLmZvbnRGYW1pbHkgPSBmb250RmFtaWx5IHx8IG51bGwpKVxuICB9XG5cbiAgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoJ3ByZScpLmZvckVhY2goZnVuY3Rpb24ocHJlRWxlbWVudCkge1xuICAgIGNvbnN0IGNvZGVCbG9jayA9IHByZUVsZW1lbnQuZmlyc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnRcbiAgICBjb25zdCBmZW5jZU5hbWUgPVxuICAgICAgY29kZUJsb2NrLmNsYXNzTmFtZS5yZXBsYWNlKC9eKGxhbmctfHNvdXJjZUNvZGUgKS8sICcnKSB8fCBkZWZhdWx0TGFuZ3VhZ2VcblxuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby11bnNhZmUtYW55IC8vIFRPRE86IHRzbGludCBidWc/XG4gICAgY29uc3QgaGlnaGxpZ2h0ZWRIdG1sOiBzdHJpbmcgPSBoaWdobGlnaHQoe1xuICAgICAgZmlsZUNvbnRlbnRzOiBjb2RlQmxvY2suaW5uZXJUZXh0LFxuICAgICAgc2NvcGVOYW1lOiBzY29wZUZvckZlbmNlTmFtZShmZW5jZU5hbWUpLFxuICAgICAgbmJzcDogZmFsc2UsXG4gICAgICBsaW5lRGl2czogZmFsc2UsXG4gICAgICBlZGl0b3JEaXY6IHRydWUsXG4gICAgICBlZGl0b3JEaXZUYWc6ICdwcmUnLFxuICAgICAgLy8gVGhlIGBlZGl0b3JgIGNsYXNzIG1lc3NlcyB0aGluZ3MgdXAgYXMgYC5lZGl0b3JgIGhhcyBhYnNvbHV0ZWx5IHBvc2l0aW9uZWQgbGluZXNcbiAgICAgIGVkaXRvckRpdkNsYXNzOiBmZW5jZU5hbWVcbiAgICAgICAgPyBgZWRpdG9yLWNvbG9ycyBsYW5nLSR7ZmVuY2VOYW1lfWBcbiAgICAgICAgOiAnZWRpdG9yLWNvbG9ycycsXG4gICAgfSlcblxuICAgIHByZUVsZW1lbnQub3V0ZXJIVE1MID0gaGlnaGxpZ2h0ZWRIdG1sXG4gIH0pXG5cbiAgcmV0dXJuIGRvYy5pbm5lckhUTUxcbn1cbiJdfQ==