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

/*  external requirements  */
const clone   = require("clone")
const blessed = require("blessed")
const Pty     = require("node-pty")
const jsdom   = require("jsdom")

/*  CRUEL HACK (part 1/2):
    xterm.js accesses the global "window" once on loading,
    so we have to emulate this environment temporarily  */
var window = global.window
var dom = new jsdom.JSDOM()
global.window = dom.window
var document = dom.window.document

/*  load xterm.js  */
const XTermJS = require("xterm")

/*  CRUEL HACK (part 2/2):
    restore global "window" again  */
global.window = window

/*  the API class  */
class XTerm extends blessed.Box {
    /*  construct the API class  */
    constructor (options = {}) {
        /*  clone options or all widget instances will show
            at least the same style, etc.  */
        options = clone(options)

        /*  disable the special "scrollable" feature of Blessed's Element
            which would use a ScrolledBox instead of a Box under the surface  */
        options.scrollable = false

        /*  pass-through options to underlying Blessed Box element  */
        super(options)

        /*  helper function for setting options  */
        const setOption = (cfg, name, def) => {
            if (this.options[name] === undefined)
                this.options[name] = def
        }

        /*  provide option fallbacks  */
        setOption(this.options, "shell",            process.env.SHELL || "sh")
        setOption(this.options, "args",             [])
        setOption(this.options, "env",              process.env)
        setOption(this.options, "cwd",              process.cwd())
        setOption(this.options, "cursorType",       "block")
        setOption(this.options, "scrollback",       1000)
        setOption(this.options, "controlKey",       "C-w")
        setOption(this.options, "ignoreKeys",       [])
        setOption(this.options, "mousePassthrough", false)

        /*  ensure style is available  */
        setOption(this.options,       "style", {})
        setOption(this.options.style, "bg",    "default")
        setOption(this.options.style, "fg",    "default")

        /*  determine border colors  */
        if (   this.options.style
            && this.options.style.focus
            && this.options.style.focus.border
            && this.options.style.focus.border.fg)
            this.borderFocus = this.options.style.focus.border.fg
        else if (
               this.options.style
            && this.options.style.border
            && this.options.style.border.fg)
            this.borderFocus = this.options.style.border.fg
        else
            this.borderFocus = this.options.style.fg || "default"
        if (   this.options.style
            && this.options.style.scrolling
            && this.options.style.scrolling.border
            && this.options.style.scrolling.border.fg)
            this.borderScrolling = this.options.style.scrolling.border.fg
        else
            this.borderScrolling = "red"

        /*  initialize scrolling mode  */
        this.scrolling = false

        /*  perform internal bootstrapping  */
        this._bootstrap()
    }

    /*  identify us to Blessed  */
    get type () {
        return "terminal"
    }

    /*  bootstrap the API class  */
    _bootstrap () {
        /*  create XTerm emulation  */
        this.term = XTermJS({
            cols:        this.width  - this.iwidth,
            rows:        this.height - this.iheight,
            cursorBlink: false,
            scrollback:  this.options.scrollback !== "none" ?
                         this.options.scrollback : this.height - this.iheight
        })

        /*  monkey-patch XTerm to prevent it from effectively rendering
            anything to the Virtual DOM, as we just grab its character buffer.
            The alternative would be to listen on the XTerm "refresh" event,
            but this way XTerm would uselessly render the DOM elements.  */
        this.term.refresh = (start, end) => {
            /*  enforce a new screen rendering,
                which in turn will call our render() method, too  */
            this.screen.render()
        }

        /*  monkey-patch XTerm to prevent any key handling  */
        this.term.keyDown  = () => {}
        this.term.keyPress = () => {}

        /*  attach XTerm to Virtual DOM  */
        var container = document.createElement("div")
        document.body.appendChild(container)
        this.term.open(container)

        /*  pass-through title changes by application  */
        this.term.on("title", (title) => {
            this.title = title
            this.emit("title", title)
        })

        /*  helper function to determine mouse inputs  */
        const _isMouse = (buf) => {
            /*  mouse event determination:
                borrowed from original Blessed Terminal widget
                Copyright (c) 2013-2015 Christopher Jeffrey et al.  */
            let s = buf
            if (Buffer.isBuffer(s)) {
                if (s[0] > 127 && s[1] === undefined) {
                    s[0] -= 128
                    s = "\x1b" + s.toString("utf-8")
                }
                else
                    s = s.toString("utf-8")
            }
            return (buf[0] === 0x1b && buf[1] === 0x5b && buf[2] === 0x4d)
                || /^\x1b\[M([\x00\u0020-\uffff]{3})/.test(s)
                || /^\x1b\[(\d+;\d+;\d+)M/.test(s)
                || /^\x1b\[<(\d+;\d+;\d+)([mM])/.test(s)
                || /^\x1b\[<(\d+;\d+;\d+;\d+)&w/.test(s)
                || /^\x1b\[24([0135])~\[(\d+),(\d+)\]\r/.test(s)
                || /^\x1b\[(O|I)/.test(s)
        }

        /*  pass raw keyboard input from Blessed to XTerm  */
        this.skipInputDataOnce   = false
        this.skipInputDataAlways = false
        this.screen.program.input.on("data", this._onScreenEventInputData = (data) => {
            /*  only in case we are focused and not in scrolling mode  */
            if (this.screen.focused !== this || this.scrolling)
                return
            if (this.skipInputDataAlways)
                return
            if (this.skipInputDataOnce) {
                this.skipInputDataOnce = false
                return
            }
            if (!_isMouse(data))
                this.injectInput(data)
        })

        /*  capture cooked keyboard input from Blessed (locally)  */
        this.on("keypress", this._onWidgetEventKeypress = (ch, key) => {
            /*  only in case we are focused  */
            if (this.screen.focused !== this)
                return

            /*  handle ignored keys  */
            if (this.options.ignoreKeys.indexOf(key.full) >= 0) {
                this.skipInputDataOnce = true
                return
            }

            /*  handle scrolling keys  */
            if (   !this.scrolling
                && this.options.controKey !== "none"
                && key.full === this.options.controlKey)
                this._scrollingStart()
            else if (this.scrolling) {
                if (   key.full === this.options.controlKey
                    || key.full.match(/^(?:escape|return|space)$/)) {
                    this._scrollingEnd()
                    this.skipInputDataOnce = true
                }
                else if (key.full === "up")       this.scroll(-1)
                else if (key.full === "down")     this.scroll(+1)
                else if (key.full === "pageup")   this.scroll(-(this.height - 2))
                else if (key.full === "pagedown") this.scroll(+(this.height - 2))
            }
        })

        /*  capture cooked keyboard input from Blessed (globally)  */
        this.onScreenEvent("keypress", this._onScreenEventKeypress = (ch, key) => {
            /*  handle ignored keys  */
            if (this.options.ignoreKeys.indexOf(key.full) >= 0)
                this.skipInputDataOnce = true
        })

        /*  pass mouse input from Blessed to XTerm  */
        if (this.options.mousePassthrough) {
            this.onScreenEvent("mouse", this._onScreenEventMouse = (ev) => {
                /*  only in case we are focused  */
                if (this.screen.focused !== this)
                    return

                /*  only in case we are touched  */
                if (   (ev.x < this.aleft + this.ileft)
                    || (ev.y < this.atop  + this.itop)
                    || (ev.x > this.aleft - this.ileft + this.width)
                    || (ev.y > this.atop  - this.itop  + this.height))
                    return

                /*  generate canonical mouse input sequence,
                    borrowed from original Blessed Terminal widget
                    Copyright (c) 2013-2015 Christopher Jeffrey et al.  */
                let b = ev.raw[0]
                let x = ev.x - this.aleft
                let y = ev.y - this.atop
                let s
                if (this.term.urxvtMouse) {
                    if (this.screen.program.sgrMouse)
                        b += 32
                    s = "\x1b[" + b + ";" + (x + 32) + ";" + (y + 32) + "M"
                }
                else if (this.term.sgrMouse) {
                    if (!this.screen.program.sgrMouse)
                        b -= 32
                    s = "\x1b[<" + b + ";" + x + ";" + y +
                        (ev.action === "mousedown" ? "M" : "m")
                }
                else {
                    if (this.screen.program.sgrMouse)
                        b += 32
                    s = "\x1b[M" +
                        String.fromCharCode(b) +
                        String.fromCharCode(x + 32) +
                        String.fromCharCode(y + 32)
                }

                /*  pass-through mouse event sequence  */
                this.injectInput(s)
            })
        }

        /*  pass-through Blessed focus/blur events to XTerm  */
        this.on("focus", () => { this.term.focus() })
        this.on("blur",  () => { this.term.blur(); this.screen.render() })

        /*  pass-through Blessed resize events to XTerm/Pty  */
        this.on("resize", () => {
            const nextTick = global.setImmediate || process.nextTick.bind(process)
            nextTick(() => {
                /*  determine new width/height  */
                let width  = this.width  - this.iwidth
                let height = this.height - this.iheight

                /*  pass-through to XTerm  */
                this.term.resize(width, height)

                /*  pass-through to Pty  */
                if (this.pty !== null) {
                    try { this.pty.resize(width, height) }
                    catch (e) { /*  NO-OP  */ }
                }
            })
        })

        /*  perform an initial resizing once  */
        this.once("render", () => {
            let width  = this.width  - this.iwidth
            let height = this.height - this.iheight
            this.term.resize(width, height)
        })

        /*  on Blessed widget destruction, tear down everything  */
        this.on("destroy", () => {
            this.kill()
            if (this._onScreenEventInput)
                this.screen.program.input.removeListener("data", this._onScreenEventInputData)
            if (this._onWidgetEventKeypress)
                this.off("keypress", this._onWidgetEventKeypress)
            if (this._onScreenEventKeypress)
                this.removeScreenEvent("keypress", this._onScreenEventKeypress)
            if (this._onScreenEventMouse)
                this.removeScreenEvent("mouse", this._onScreenEventMouse)
        })

        /*  establish the Pty  */
        this.pty = null
        if (this.options.shell !== null)
            this.spawn(this.options.shell, this.options.args)
    }

    /*  process input data  */
    enableInput (process) {
        this.skipInputDataAlways = !process
    }

    /*  inject input data  */
    injectInput (data) {
        if (this.pty !== null)
            this.pty.write(data)
    }

    /*  write data to the terminal  */
    write (data) {
        return this.term.write(data)
    }

    /*  render the widget  */
    render () {
        /*  call the underlying Element's rendering function  */
        let ret = this._render()
        if (!ret)
            return

        /*  framebuffer synchronization:
            borrowed from original Blessed Terminal widget
            Copyright (c) 2013-2015 Christopher Jeffrey et al.  */

        /*  determine display attributes  */
        this.dattr = this.sattr(this.style)

        /*  determine position  */
        let xi = ret.xi + this.ileft
        let xl = ret.xl - this.iright
        let yi = ret.yi + this.itop
        let yl = ret.yl - this.ibottom

        /*  iterate over all lines  */
        let cursor
        let dirtyAny = false
        for (let y = Math.max(yi, 0); y < yl; y++) {
            /*  fetch Blessed Screen and XTerm lines  */
            let sline = this.screen.lines[y]
            let tline = this.term.lines.get(this.term.ydisp + y - yi)
            if (!sline || !tline)
                break

            /*  update sline from tline  */
            let dirty = false
            const updateSLine = (s1, s2, val) => {
                if (sline[s1][s2] !== val) {
                    sline[s1][s2] = val
                    dirty = true
                }
            }

            /*  determine cursor column position  */
            if (   y === yi + this.term.y
                && this.term.cursorState
                && this.screen.focused === this
                && (this.term.ydisp === this.term.ybase || this.term.selectMode)
                && !this.term.cursorHidden                                      )
                cursor = xi + this.term.x
            else
                cursor = -1

            /*  iterate over all columns  */
            for (let x = Math.max(xi, 0); x < xl; x++) {
                if (!sline[x] || !tline[x - xi])
                    break

                /*  read terminal attribute and character  */
                let x0 = tline[x - xi][0]
                let x1 = tline[x - xi][1]

                /*  handle cursor  */
                if (x === cursor) {
                    if (this.options.cursorType === "line") {
                        x0 = this.dattr
                        x1 = "\u2502"
                    }
                    else if (this.options.cursorType === "underline")
                        x0 = this.dattr | (2 << 18)
                    else if (this.options.cursorType === "block")
                        x0 = this.dattr | (8 << 18)
                }

                /*  default foreground is 257  */
                if (((x0 >> 9) & 0x1ff) === 257)
                    x0 = (x0 & ~(0x1ff << 9)) | (((this.dattr >> 9) & 0x1ff) << 9)

                /*  default background is 256  */
                if ((x0 & 0x1ff) === 256)
                    x0 = (x0 & ~0x1ff) | (this.dattr & 0x1ff)

                /*  write screen attribute and character  */
                updateSLine(x, 0, x0)
                updateSLine(x, 1, x1)
            }

            /*  mark Blessed Screen line as dirty  */
            if (dirty) {
                sline.dirty = true
                dirtyAny    = true
            }
        }

        /*  indicate that we updated our rendered content  */
        if (dirtyAny > 0)
            this.emit("update")

        return ret
    }

    /*  support scrolling similar to Blessed ScrolledBox  */
    _scrollingStart () {
        this.scrolling = true
        this.style.focus.border.fg = this.borderScrolling
        this.focus()
        this.screen.render()
        this.emit("scrolling-start")
    }
    _scrollingEnd () {
        this.term.scrollToBottom()
        this.style.focus.border.fg = this.borderFocus
        this.focus()
        this.screen.render()
        this.scrolling = false
        this.emit("scrolling-end")
    }
    getScroll () {
        return this.term.ydisp
    }
    getScrollHeight () {
        return this.term.rows - 1
    }
    getScrollPerc () {
        return (this.term.ybase > 0 ? ((this.term.ydisp / this.term.ybase) * 100) : 100)
    }
    setScrollPerc (i) {
        return this.setScroll(Math.floor((i / 100) * this.term.ybase))
    }
    setScroll (offset) {
        return this.scrollTo(offset)
    }
    scrollTo (offset) {
        if (!this.scrolling)
            this._scrollingStart()
        this.term.scrollDisp(offset - this.term.ydisp)
        this.screen.render()
        this.emit("scroll")
    }
    scroll (offset) {
        if (!this.scrolling)
            this._scrollingStart()
        this.term.scrollDisp(offset)
        this.screen.render()
        this.emit("scroll")
    }
    resetScroll () {
        if (this.scrolling)
            this._scrollingEnd()
    }

    /*  kill widget  */
    kill () {
        /*  terminate application on Pty  */
        this.terminate()

        /*  tear down XTerm  */
        this.term.refresh = () => {}
        this.term.write("\x1b[H\x1b[J")
        this.term.clearCursorBlinkingInterval()
        this.term.destroy()
    }

    /*  spawn shell command on Pty  */
    spawn (shell, args, cwd, env) {
        if (this.pty)
            this.terminate()
        env = Object.assign({}, env || this.options.env || process.env, { TERM: "xterm" })
        this.pty = Pty.fork(shell, args, {
            name:  "xterm",
            cols:  this.width  - this.iwidth,
            rows:  this.height - this.iheight,
            cwd:   cwd || this.options.cwd || process.cwd(),
            env:   env
        })
        this.pty.on("data", (data) => {
            this.write(data)
            if (data instanceof Buffer)
                data = data.toString()
            if (data.match(/\x07/))
                this.emit("beep")
        })
        this.pty.on("exit", (code) => {
            this.emit("exit", code || 0)
        })
    }

    /*  terminate shell command on Pty  */
    terminate () {
        if (this.pty) {
            this.pty.destroy()
            this.pty = null
        }
    }
}

/*  export API class the traditional way  */
module.exports = XTerm

