/*
**  blessed-xterm -- XTerm Widget for Blessed Curses Environment
**  Copyright (c) 2017 Ralf S. Engelschall <rse@engelschall.com>
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

const blessed  = require("blessed")
const XTerm    = require("./blessed-xterm")

const screen = blessed.screen({
    title:       "sample",
    smartCSR:    true,
    autoPadding: false,
    warnings:    false
})

let focused = 0
let terminal = []

let opts = {
    shell:         process.env.SHELL || "sh",
    args:          [],
    env:           process.env,
    cwd:           process.cwd(),
    cursorType:    "block",
    border:        "line",
    scrollback:    1000,
    style: {
        fg:        "default",
        bg:        "default",
        border:    { fg: "default" },
        focus:     { border: { fg: "green" } },
        scrolling: { border: { fg: "red" } }
    }
}

terminal[0] = new XTerm(Object.assign({}, opts, {
    left:    0,
    top:     0,
    width:   Math.floor(screen.width / 2),
    height:  screen.height,
    label:   "Sample XTerm #1"
}))

terminal[1] = new XTerm(Object.assign({}, opts, {
    left:    Math.floor(screen.width / 2),
    top:     0,
    width:   Math.floor(screen.width / 2),
    height:  screen.height,
    label:   "Sample XTerm #2"
}))

let hint = "\r\nPress CTRL+q to stop sample program.\r\n" +
    "Press F1 or F2 to switch between terminals.\r\n\r\n"
terminal[0].write(hint)
terminal[1].write(hint)

terminal[focused].focus()

screen.key([ "f1" ], (ch, key) => {
    if (focused > 0) {
        focused--
        terminal[focused].focus()
    }
})
screen.key([ "f2" ], (ch, key) => {
    if (focused < terminal.length - 1) {
        focused++
        terminal[focused].focus()
    }
})

const terminate = () => {
    screen.destroy()
    process.exit(0)
}

screen.key([ "C-q" ], (ch, key) => {
    terminate()
})

screen.append(terminal[0])
screen.append(terminal[1])
screen.render()

let terminated = 0
terminal.forEach((w) => {
    w.on("exit", () => {
        terminated++
        if (terminated === terminal.length)
            terminate()
    })
})

