const requirejs = require("requirejs")
requirejs.config({ nodeRequire: require })

const highlighter = requirejs("node_modules/ace-code-editor/lib/ace/ext/static_highlight")
const theme = requirejs("node_modules/ace-code-editor/lib/ace/theme/github")
const modes = {
    R: requirejs("node_modules/ace-code-editor/lib/ace/mode/r").Mode,
    Python: requirejs("node_modules/ace-code-editor/lib/ace/mode/python").Mode,
    HTML: requirejs("node_modules/ace-code-editor/lib/ace/mode/html").Mode,
    Markdown: requirejs("node_modules/ace-code-editor/lib/ace/mode/markdown").Mode
}

module.exports = function build(code, language = "R") {
    var highlighted = highlighter.render(code, new (modes[language]), theme)
    return { html: highlighted.html, css: highlighted.css }
}