/*
**  blessed-xterm -- XTerm Widget for Blessed Curses Environment
**  Copyright (c) 2017-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import js        from "@eslint/js"
import globals   from "globals"
import stylistic from "@stylistic/eslint-plugin"
import n         from "eslint-plugin-n"
import promise   from "eslint-plugin-promise"

export default [
    js.configs.recommended,
    n.configs["flat/recommended-script"],
    promise.configs["flat/recommended"],
    {
        plugins: {
            "@stylistic": stylistic
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType:  "commonjs",
            globals: {
                ...globals.node,
                process: true
            }
        },
        rules: {
            /*  modified rules  */
            "@stylistic/indent":                 [ "error", 4, { "SwitchCase": 1 } ],
            "@stylistic/linebreak-style":        [ "error", "unix" ],
            "@stylistic/semi":                   [ "error", "never" ],
            "@stylistic/operator-linebreak":     [ "error", "after", { "overrides": { "&&": "before", "||": "before", ":": "before" } } ],
            "@stylistic/brace-style":            [ "error", "stroustrup", { "allowSingleLine": true } ],
            "@stylistic/quotes":                 [ "error", "double" ],

            /*  disabled rules  */
            "@stylistic/no-multi-spaces":             "off",
            "@stylistic/no-multiple-empty-lines":     "off",
            "@stylistic/key-spacing":                 "off",
            "@stylistic/object-property-newline":     "off",
            "@stylistic/space-in-parens":             "off",
            "@stylistic/array-bracket-spacing":       "off",
            "@stylistic/lines-between-class-members": "off",
            "curly":                                  "off",
            "no-control-regex":                       "off",
            "n/no-process-exit":                      "off",

            /*  allow unused function arguments and caught errors  */
            "no-unused-vars":                         [ "error", { "args": "none", "caughtErrors": "none" } ]
        }
    }
]
