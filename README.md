
Blessed-XTerm
=============

**XTerm Widget for Blessed Curses Environment**

<p/>
<img src="https://nodei.co/npm/blessed-xterm.png?downloads=true&stars=true" alt=""/>

<p/>
<img src="https://david-dm.org/rse/blessed-xterm.png" alt=""/>

Abstract
--------

This is an XTerm emulating terminal widget for the flexible
[Blessed](https://github.com/chjj/blessed) Curses environment. It allows
the execution of interactive terminal programs in a Blessed Box widget
while providing a full-featured emulated XTerm rendering environment to
those programs.

Blessed XTerm is actually a more modern variant of the Terminal widget
as shipped with the Blessed Curses environment. The difference to the
regular Terminal widget is: the Blessed XTerm widget it uses the newer
[node-pty](https://github.com/Tyriar/node-pty) instead of the ancient
[pty.js](https://github.com/chjj/pty.js/) PTY management module, it
uses the newer [XTerm.js](https://xtermjs.org/) instead of the ancient
[Term.js](https://github.com/chjj/term.js/) XTerm emulation module, it
provides full scrollback buffer support and it supports starting and
stopping multiple commands while the widget is active.

License
-------

Copyright (c) 2017 Ralf S. Engelschall (http://engelschall.com/)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

