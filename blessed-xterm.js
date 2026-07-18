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

/*  external requirements  */
const clone   = require("clone")
const blessed = require("blessed")
const Pty     = require("node-pty")

/*  load xterm.js (headless variant, as we render into Blessed ourselves)  */
const XTermJS = require("@xterm/headless")

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
            if (cfg[name] === undefined)
                cfg[name] = def
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
        this.term = new XTermJS.Terminal({
            cols:        this.width  - this.iwidth,
            rows:        this.height - this.iheight,
            cursorBlink: false,

            /*  the character buffer access we base our rendering on
                is still classified as a "proposed" API by XTerm.js  */
            allowProposedApi: true,
            scrollback:  this.options.scrollback !== "none" ? this.options.scrollback : this.height - this.iheight
        })

        /*  react on XTerm buffer changes, as we just grab its character buffer.
            The headless XTerm variant renders nothing on its own, hence it
            provides no "render" event and we instead trigger our own rendering
            once the written data was parsed into the character buffer.  */
        this.term.onWriteParsed(() => {
            /*  enforce a new screen rendering,
                which in turn will call our render() method, too  */
            this.screen.render()
        })

        /*  react on scrolling and cursor movements, as these change the
            visible result without necessarily parsing any new data  */
        this.term.onScroll(()     => { this.screen.render() })
        this.term.onCursorMove(() => { this.screen.render() })

        /*  pass-through title changes by application  */
        this.term.onTitleChange((title) => {
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
                const x = ev.x - this.aleft
                const y = ev.y - this.atop
                let s

                /*  XTerm.js no longer exposes the negotiated mouse encoding,
                    so emit the SGR encoding, which all relevant applications
                    negotiate nowadays, or the legacy X10 encoding in case the
                    application requested no mouse tracking at all  */
                if (this.term.modes.mouseTrackingMode !== "none") {
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

        /*  react on Blessed focus/blur events. The headless XTerm variant has
            no notion of focus, as this was a purely DOM-related aspect, so we
            just have to re-render in order to show/hide our own cursor.  */
        this.on("focus", () => { this.screen.render() })
        this.on("blur",  () => { this.screen.render() })

        /*  pass-through Blessed resize events to XTerm/Pty  */
        this.on("resize", () => {
            const nextTick = global.setImmediate || process.nextTick.bind(process)
            nextTick(() => {
                /*  determine new width/height  */
                const width  = this.width  - this.iwidth
                const height = this.height - this.iheight

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
            const width  = this.width  - this.iwidth
            const height = this.height - this.iheight
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

        /*  pre-allocate a single buffer cell object, as the XTerm API
            allows us to reuse it and this avoids one object allocation
            per character cell on every single rendering  */
        this._cell = this.term.buffer.active.getNullCell()

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
        this.term.write(data)
    }

    /*  determine whether the application hid the cursor via "CSI ? 2 5 l".
        Unfortunately, XTerm.js does not expose this state through its public
        API, so we have to reach into its internals and gracefully fall back
        to a visible cursor in case this internal structure ever changes.  */
    _isCursorHidden () {
        const coreService = this.term._core?.coreService
        return typeof coreService?.isCursorHidden === "boolean" ?
            coreService.isCursorHidden : false
    }

    /*  convert an XTerm buffer cell into a Blessed screen attribute.
        Blessed packs an attribute into the bit layout
        "flags (9 bit) | foreground (9 bit) | background (9 bit)",
        while XTerm.js exposes the very same information through
        accessor methods only, so we have to reassemble it here.  */
    _cellToAttr (cell) {
        /*  start off with our own default attribute, so that cells
            using the terminal defaults inherit the widget style  */
        let fg = (this.dattr >> 9) & 0x1ff
        let bg =  this.dattr       & 0x1ff

        /*  determine foreground color  */
        if (!cell.isFgDefault()) {
            if (cell.isFgPalette())
                fg = cell.getFgColor()
            else if (cell.isFgRGB())
                fg = this._rgbToPalette(cell.getFgColor())
        }

        /*  determine background color  */
        if (!cell.isBgDefault()) {
            if (cell.isBgPalette())
                bg = cell.getBgColor()
            else if (cell.isBgRGB())
                bg = this._rgbToPalette(cell.getBgColor())
        }

        /*  determine character attribute flags  */
        let flags = 0
        if (cell.isBold())          flags |= 1
        if (cell.isUnderline())     flags |= 2
        if (cell.isBlink())         flags |= 4
        if (cell.isInverse())       flags |= 8
        if (cell.isInvisible())     flags |= 16

        return (flags << 18) | (fg << 9) | bg
    }

    /*  reduce a 24-bit RGB color to the 256-color palette Blessed operates on  */
    _rgbToPalette (rgb) {
        const r = (rgb >> 16) & 0xff
        const g = (rgb >>  8) & 0xff
        const b = (rgb      ) & 0xff
        return blessed.colors.match(r, g, b)
    }

    /*  render the widget  */
    render () {
        /*  call the underlying Element's rendering function  */
        const ret = this._render()
        if (!ret)
            return

        /*  framebuffer synchronization:
            borrowed from original Blessed Terminal widget
            Copyright (c) 2013-2015 Christopher Jeffrey et al.  */

        /*  determine display attributes  */
        this.dattr = this.sattr(this.style)

        /*  determine position  */
        const xi = ret.xi + this.ileft
        const xl = ret.xl - this.iright
        const yi = ret.yi + this.itop
        const yl = ret.yl - this.ibottom

        /*  fetch the currently active XTerm buffer  */
        const buffer = this.term.buffer.active

        /*  iterate over all lines  */
        let cursor
        let dirtyAny = false
        const cell = this._cell
        for (let y = Math.max(yi, 0); y < yl; y++) {
            /*  fetch Blessed Screen and XTerm lines  */
            const sline = this.screen.lines[y]
            const tline = buffer.getLine(buffer.viewportY + y - yi)
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
            if (   y === yi + buffer.cursorY
                && this.screen.focused === this
                && buffer.viewportY === buffer.baseY
                && !this._isCursorHidden())
                cursor = xi + buffer.cursorX
            else
                cursor = -1

            /*  iterate over all columns  */
            for (let x = Math.max(xi, 0); x < xl; x++) {
                if (!sline[x] || !tline.getCell(x - xi, cell))
                    break

                /*  read terminal attribute and character  */
                let x0 = this._cellToAttr(cell)
                let x1 = cell.getChars() || " "

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
        return this.term.buffer.active.viewportY
    }
    getScrollHeight () {
        return this.term.rows - 1
    }
    getScrollPerc () {
        const buffer = this.term.buffer.active
        return (buffer.baseY > 0 ? ((buffer.viewportY / buffer.baseY) * 100) : 100)
    }
    setScrollPerc (i) {
        return this.setScroll(Math.floor((i / 100) * this.term.buffer.active.baseY))
    }
    setScroll (offset) {
        return this.scrollTo(offset)
    }
    scrollTo (offset) {
        if (!this.scrolling)
            this._scrollingStart()
        this.term.scrollLines(offset - this.term.buffer.active.viewportY)
        this.screen.render()
        this.emit("scroll")
    }
    scroll (offset) {
        if (!this.scrolling)
            this._scrollingStart()
        this.term.scrollLines(offset)
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
        this.term.write("\x1b[H\x1b[J")
        this.term.dispose()
    }

    /*  spawn shell command on Pty  */
    spawn (shell, args, cwd, env) {
        /*  termine old PTY  */
        if (this.pty)
            this.terminate()

        /*  establish environment  */
        env = Object.assign({},
            process.env,
            typeof this.options.env === "object" ? this.options.env : {},
            typeof env === "object" ? env : {}
        )
        if (   env.TERM === undefined
            || !(typeof env.TERM === "string" && env.TERM.match(/^xterm(?:-.+)?$/)))
            env.TERM = "xterm"

        /*  create new PTY  */
        this.pty = Pty.fork(shell, args, {
            name:  "xterm",
            cols:  this.width  - this.iwidth,
            rows:  this.height - this.iheight,
            cwd:   cwd || this.options.cwd || process.cwd(),
            env
        })

        /*  process data on PTY  */
        this.pty.on("data", (data) => {
            this.write(data)
            if (data instanceof Buffer)
                data = data.toString()
            if (data.match(/\x07/))
                this.emit("beep")
        })

        /*  handle PTY termination  */
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

