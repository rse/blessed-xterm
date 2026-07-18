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

    /*  determine the inner (content) size of the widget  */
    _innerSize () {
        return {
            cols: Math.max(1, this.width  - this.iwidth),
            rows: Math.max(1, this.height - this.iheight)
        }
    }

    /*  propagate the current inner size to XTerm and Pty  */
    _resize () {
        const { cols, rows } = this._innerSize()
        if (this.term)
            this.term.resize(cols, rows)
        if (this.pty) {
            /*  intentionally ignored: the Pty can already be gone
                because the application exited meanwhile  */
            try { this.pty.resize(cols, rows) }
            catch { /*  NO-OP  */ }
        }
    }

    /*  bootstrap the API class  */
    _bootstrap () {
        /*  track the deferred resize operation  */
        this._resizeTimer = null

        /*  create XTerm emulation  */
        const { cols, rows } = this._innerSize()
        this.term = new XTermJS.Terminal({
            cols,
            rows,
            cursorBlink: false,

            /*  the character buffer access we base our rendering on
                is still classified as a "proposed" API by XTerm.js  */
            allowProposedApi: true,
            scrollback:  this.options.scrollback !== "none" ? this.options.scrollback : rows
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
        const rerender = () => { this.screen.render() }
        this.term.onScroll(rerender)
        this.term.onCursorMove(rerender)

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
                if (s[0] > 127 && s[1] === undefined)
                    s = "\x1b" + Buffer.from([ s[0] - 128 ]).toString("utf-8")
                else
                    s = s.toString("utf-8")
            }
            return (Buffer.isBuffer(buf) && buf[0] === 0x1b && buf[1] === 0x5b && buf[2] === 0x4d)
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
        this.on("keypress", this._onWidgetEventKeypress = (_ch, key) => {
            /*  only in case we are focused  */
            if (this.screen.focused !== this)
                return

            /*  handle ignored keys  */
            if (this.options.ignoreKeys.includes(key.full)) {
                this.skipInputDataOnce = true
                return
            }

            /*  handle scrolling keys  */
            if (   !this.scrolling
                && this.options.controlKey !== "none"
                && key.full === this.options.controlKey)
                this._scrollingStart()
            else if (this.scrolling) {
                if (   key.full === this.options.controlKey
                    || [ "escape", "return", "space" ].includes(key.full)) {
                    this._scrollingEnd()
                    this.skipInputDataOnce = true
                }
                else if (key.full === "up")       this.scroll(-1)
                else if (key.full === "down")     this.scroll(+1)
                else if (key.full === "pageup")   this.scroll(-this._innerSize().rows)
                else if (key.full === "pagedown") this.scroll(+this._innerSize().rows)
            }
        })

        /*  capture cooked keyboard input from Blessed (globally)  */
        this.onScreenEvent("keypress", this._onScreenEventKeypress = (_ch, key) => {
            /*  handle ignored keys  */
            if (this.options.ignoreKeys.includes(key.full))
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
                    || (ev.x >= this.aleft + this.width  - this.iright)
                    || (ev.y >= this.atop  + this.height - this.ibottom))
                    return

                /*  generate canonical mouse input sequence,
                    borrowed from original Blessed Terminal widget
                    Copyright (c) 2013-2015 Christopher Jeffrey et al.  */
                let b = ev.raw[0]
                const x = Math.min(223, ev.x - this.aleft - this.ileft + 1)
                const y = Math.min(223, ev.y - this.atop  - this.itop  + 1)
                let s

                /*  XTerm.js no longer exposes the negotiated mouse encoding,
                    so emit the SGR encoding, which all relevant applications
                    negotiate nowadays, or the legacy X10 encoding in case the
                    application requested no mouse tracking at all  */

                /*  normalize the button byte to the un-offset SGR form  */
                if (!this.screen.program.sgrMouse)
                    b -= 32
                if (this.term.modes.mouseTrackingMode !== "none") {
                    s = "\x1b[<" + b + ";" + x + ";" + y +
                        (ev.action === "mousedown" ? "M" : "m")
                }
                else {
                    s = "\x1b[M" +
                        String.fromCharCode(b + 32) +
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
        for (const event of [ "focus", "blur" ])
            this.on(event, rerender)

        /*  pass-through Blessed resize events to XTerm/Pty  */
        this.on("resize", () => {
            if (this._resizeTimer !== null)
                clearImmediate(this._resizeTimer)
            this._resizeTimer = setImmediate(() => {
                this._resizeTimer = null
                this._resize()
            })
        })

        /*  perform an initial resizing once  */
        this.once("render", () => { this._resize() })

        /*  on Blessed widget destruction, tear down everything  */
        this.on("destroy", () => {
            this.kill()
            if (this._onScreenEventInputData) {
                this.screen.program.input.removeListener("data", this._onScreenEventInputData)
                this._onScreenEventInputData = null
            }
            if (this._onWidgetEventKeypress) {
                this.off("keypress", this._onWidgetEventKeypress)
                this._onWidgetEventKeypress = null
            }
            if (this._onScreenEventKeypress) {
                this.removeScreenEvent("keypress", this._onScreenEventKeypress)
                this._onScreenEventKeypress = null
            }
            if (this._onScreenEventMouse) {
                this.removeScreenEvent("mouse", this._onScreenEventMouse)
                this._onScreenEventMouse = null
            }
            if (this._resizeTimer !== null) {
                clearImmediate(this._resizeTimer)
                this._resizeTimer = null
            }
            this._cell = null
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
    enableInput (enable) {
        this.skipInputDataAlways = !enable
    }

    /*  inject input data  */
    injectInput (data) {
        if (this.pty !== null)
            this.pty.write(data)
    }

    /*  write data to the terminal  */
    write (data) {
        if (this.term !== null)
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

        /*  determine foreground/background color  */
        const color = (isDefault, isPalette, isRGB, get, fallback) => {
            if (isDefault.call(cell))
                return fallback
            if (isPalette.call(cell))
                return get.call(cell)
            if (isRGB.call(cell))
                return this._rgbToPalette(get.call(cell))
            return fallback
        }
        fg = color(cell.isFgDefault, cell.isFgPalette, cell.isFgRGB, cell.getFgColor, fg)
        bg = color(cell.isBgDefault, cell.isBgPalette, cell.isBgRGB, cell.getBgColor, bg)

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
        if (!ret || this.term === null)
            return ret

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
                let attr = this._cellToAttr(cell)
                let char = cell.getChars() || " "

                /*  handle cursor  */
                if (x === cursor) {
                    if (this.options.cursorType === "line") {
                        attr = this.dattr
                        char = "\u2502"
                    }
                    else if (this.options.cursorType === "underline")
                        attr = this.dattr | (2 << 18)
                    else if (this.options.cursorType === "block")
                        attr = this.dattr | (8 << 18)
                }

                /*  write screen attribute and character  */
                updateSLine(x, 0, attr)
                updateSLine(x, 1, char)
            }

            /*  mark Blessed Screen line as dirty  */
            if (dirty) {
                sline.dirty = true
                dirtyAny    = true
            }
        }

        /*  indicate that we updated our rendered content  */
        if (dirtyAny)
            this.emit("update")

        return ret
    }

    /*  set the border color of the focused state  */
    _setFocusBorder (color) {
        if (typeof this.style.focus?.border === "object")
            this.style.focus.border.fg = color
    }

    /*  support scrolling similar to Blessed ScrolledBox  */
    _scrollingStart () {
        this.scrolling = true
        this._setFocusBorder(this.borderScrolling)
        this.focus()
        this.screen.render()
        this.emit("scrolling-start")
    }
    _scrollingEnd () {
        this.scrolling = false
        if (this.term !== null)
            this.term.scrollToBottom()
        this._setFocusBorder(this.borderFocus)
        this.focus()
        this.screen.render()
        this.emit("scrolling-end")
    }
    getScroll () {
        return this.term !== null ? this.term.buffer.active.viewportY : 0
    }
    getScrollHeight () {
        return this.term !== null ? this.term.buffer.active.baseY : 0
    }
    getScrollPerc () {
        if (this.term === null)
            return 0
        const buffer = this.term.buffer.active
        return (buffer.baseY > 0 ? ((buffer.viewportY / buffer.baseY) * 100) : 0)
    }
    setScrollPerc (i) {
        const perc = Math.min(100, Math.max(0, i))
        return this.setScroll(Math.floor((perc / 100) * this.getScrollHeight()))
    }
    setScroll (offset) {
        return this.scrollTo(offset)
    }
    scrollTo (offset) {
        this.scroll(offset - this.getScroll())
    }
    scroll (offset) {
        if (this.term === null)
            return
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

        /*  tear down XTerm (just once)  */
        if (this.term !== null) {
            this.term.write("\x1b[H\x1b[J")
            this.term.dispose()
            this.term = null
        }
    }

    /*  spawn shell command on Pty  */
    spawn (shell, args, cwd, env) {
        /*  terminate old PTY  */
        if (this.pty !== null)
            this.terminate()

        /*  establish environment  */
        const environment = {
            ...(typeof this.options.env === "object" ? this.options.env : process.env),
            ...(typeof env === "object" ? env : {})
        }
        if (   typeof environment.TERM !== "string"
            || !/^xterm(?:-.+)?$/.test(environment.TERM))
            environment.TERM = "xterm"

        /*  create new PTY  */
        const { cols, rows } = this._innerSize()
        try {
            this.pty = Pty.fork(shell, args, {
                name:  "xterm",
                cols,
                rows,
                cwd:   cwd || this.options.cwd || process.cwd(),
                env:   environment
            })
        }
        catch (err) {
            this.pty = null

            /*  avoid an uncaught exception in case nobody listens  */
            if (this.listenerCount("error") > 0)
                this.emit("error", err)
            else
                this.emit("exit", -1)
            return
        }

        /*  process data on PTY  */
        this.pty.on("data", (data) => {
            this.write(data)
            if (data instanceof Buffer)
                data = data.toString()
            if (data.includes("\x07"))
                this.emit("beep")
        })

        /*  handle PTY termination  */
        this.pty.on("exit", (code) => {
            this.emit("exit", code || 0)
        })
    }

    /*  terminate shell command on Pty  */
    terminate () {
        if (this.pty !== null) {
            this.pty.removeAllListeners()

            /*  intentionally ignored: the Pty can already be gone  */
            try { this.pty.destroy() }
            catch { /*  NO-OP  */ }
            this.pty = null
        }
    }
}

/*  export API class the traditional way  */
module.exports = XTerm

