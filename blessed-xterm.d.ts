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

import * as blessed  from "blessed"
import * as Pty      from "node-pty"
import * as XTermJS  from "@xterm/headless"

/*  the base widget class, based on Blessed's Box element, but with
    those members stripped which we redefine with own signatures below  */
type XTermBase = Omit<blessed.Widgets.BoxElement,
    "enableInput" | "render" | "type" | "on">

/*  the widget class. It is declared as an interface merged with the
    class below, as Blessed types its inherited members as properties
    rather than methods, which a class declaration cannot re-declare.  */
interface XTerm extends XTermBase {
    /*  the widget type, as known to Blessed  */
    readonly type: string

    /*  enable or disable the processing of keyboard input  */
    enableInput (enable: boolean): void

    /*  render the widget onto the Blessed screen  */
    render (): blessed.Widgets.Coords | undefined

    /*  widget-specific events  */
    on (event: "title",           listener: (title: string) => void): this
    on (event: "beep",            listener: () => void): this
    on (event: "update",          listener: () => void): this
    on (event: "scroll",          listener: () => void): this
    on (event: "scrolling-start", listener: () => void): this
    on (event: "scrolling-end",   listener: () => void): this
    on (event: "exit",            listener: (code: number) => void): this
    on (event: string, listener: (...args: any[]) => void): this
}

/*  the widget class  */
declare class XTerm {
    /*  construct the widget  */
    constructor (options?: XTerm.Options)

    /*  the underlying XTerm.js terminal emulation
        (set to null once kill() was called)  */
    term: XTermJS.Terminal | null

    /*  the underlying Pty of the spawned application
        (null in case no application is currently running)  */
    pty: Pty.IPty | null

    /*  whether the widget currently is in scrolling mode  */
    scrolling: boolean

    /*  the resolved widget options  */
    options: XTerm.OptionsResolved

    /*  inject input data into the application on the Pty  */
    injectInput (data: string | Buffer): void

    /*  write output data into the terminal emulation  */
    write (data: string | Uint8Array): void

    /*  determine the current scrolling offset  */
    getScroll (): number

    /*  determine the height of the scrolling area  */
    getScrollHeight (): number

    /*  determine the current scrolling position in percent  */
    getScrollPerc (): number

    /*  set the current scrolling position in percent  */
    setScrollPerc (perc: number): void

    /*  set the current scrolling offset (alias of scrollTo)  */
    setScroll (offset: number): void

    /*  scroll to an absolute offset  */
    scrollTo (offset: number): void

    /*  scroll by a relative offset  */
    scroll (offset: number): void

    /*  leave the scrolling mode  */
    resetScroll (): void

    /*  terminate the application and tear down the terminal emulation  */
    kill (): void

    /*  spawn an application on a (new) Pty  */
    spawn (shell: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): void

    /*  terminate the application on the Pty  */
    terminate (): void
}

declare namespace XTerm {
    /*  the supported cursor rendering types  */
    type CursorType = "block" | "underline" | "line"

    /*  the widget options  */
    interface Options extends blessed.Widgets.BoxOptions {
        /*  the shell command to spawn (or null for spawning nothing)  */
        shell?: string | null

        /*  the arguments to the shell command  */
        args?: string[]

        /*  the environment of the shell command  */
        env?: NodeJS.ProcessEnv

        /*  the working directory of the shell command  */
        cwd?: string

        /*  the rendering type of the cursor  */
        cursorType?: CursorType

        /*  the number of scrollback lines (or "none" for no scrollback)  */
        scrollback?: number | "none"

        /*  the key entering the scrolling mode (or "none" for no such key)  */
        controlKey?: string

        /*  the keys not passed through to the application  */
        ignoreKeys?: string[]

        /*  whether mouse events are passed through to the application  */
        mousePassthrough?: boolean
    }

    /*  the widget options, after the fallbacks were applied  */
    interface OptionsResolved extends Options {
        shell:            string | null
        args:             string[]
        env:              NodeJS.ProcessEnv
        cwd:              string
        cursorType:       CursorType
        scrollback:       number | "none"
        controlKey:       string
        ignoreKeys:       string[]
        mousePassthrough: boolean
    }
}

export = XTerm

