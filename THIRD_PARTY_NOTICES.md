# Third-party notices

runly is MIT licensed. It bundles one third-party file and, at run time,
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

### browser_wasi_shim 0.4.2 (`dist/runtimes/wasi.js`)

https://github.com/bjorn3/browser_wasi_shim — dual-licensed MIT OR Apache-2.0;
redistributed here under the MIT license:

```
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### xcc-wasm 0.1.0 glue (`dist/runtimes/xcc.js`) and mruby-wasm-js 0.2.0 glue (`dist/runtimes/mruby.js`)

Both MIT licensed:
- https://forge.apps.education.fr/romain.casati/xcc-wasm (Romain Casati), built on
  https://github.com/tyfkda/xcc (MIT)
- https://github.com/takahashim/mruby-wasm-runtime, built on https://github.com/mruby/mruby (MIT)

## Loaded at run time (not redistributed in this package)

| Project | Version | License | Source |
|---|---|---|---|
| MicroPython (WebAssembly port) | 1.29.0-6 | MIT | https://github.com/micropython/micropython |
| Pyodide | 314.0.7 | MPL-2.0 | https://github.com/pyodide/pyodide |
| sql.js | 1.15.2 | MIT | https://github.com/sql-js/sql.js |
| YoWASP Clang (LLVM, Clang, LLD, wasi-libc, libc++) | 22.0.0-git20542-10 | ISC; LLVM parts Apache-2.0 WITH LLVM-exception | https://github.com/YoWASP/clang |
| xcc compiler and libc (@basthon/xcc-wasm) | 0.1.0 | MIT | https://github.com/tyfkda/xcc |
| mruby (@takahashim/mruby-wasm-js) | 0.2.0 | MIT | https://github.com/mruby/mruby |
| yaegi (via runly-go) | 0.16.1 | Apache-2.0 | https://github.com/traefik/yaegi |
| teavm-javac (via runly-java) | prebuilt from teavm.org | Apache-2.0; bundled OpenJDK parts GPL-2.0 WITH Classpath-exception-2.0 | https://github.com/konsoletyper/teavm-javac |
| ruby.wasm | 2.10.1 (CRuby 3.4) | MIT; CRuby under the Ruby License / BSD-2-Clause | https://github.com/ruby/ruby.wasm |

Pyodide also loads CPython (PSF License) and any Python packages a snippet
imports, each under its own license.
