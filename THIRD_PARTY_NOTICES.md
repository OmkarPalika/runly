# Third-party notices

runbox is MIT licensed. It bundles one third-party file and, at run time,
loads other runtimes from a CDN (or from URLs you configure). Those projects
keep their own licenses.

## Bundled

### Sucrase 3.35.1 (`dist/runtimes/sucrase.js`)

https://github.com/alangpierce/sucrase

```
The MIT License (MIT)

Copyright (c) 2012-2018 various contributors (see AUTHORS)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Loaded at run time (not redistributed in this package)

| Project | Version | License | Source |
|---|---|---|---|
| MicroPython (WebAssembly port) | 1.29.0-6 | MIT | https://github.com/micropython/micropython |
| Pyodide | 314.0.7 | MPL-2.0 | https://github.com/pyodide/pyodide |
| sql.js | 1.15.2 | MIT | https://github.com/sql-js/sql.js |

Pyodide also loads CPython (PSF License) and any Python packages a snippet
imports, each under its own license.
