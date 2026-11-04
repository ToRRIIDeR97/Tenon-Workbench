# Third-party notices

Tenon Workbench's local dictation engine (`tenon/packages/dictation`, binary `tenon-dictation`)
is built on the speech stack of [Handy](https://github.com/cjpais/Handy) by CJ Pais. The engine
links the crates below; their licence texts follow. Speech models downloaded in the Dictation
settings carry their own model licences (shown on each model's Hugging Face page) and are not
part of this repository.

| Component | Used for | Licence | Source |
| --- | --- | --- | --- |
| Handy | Engine design: recording, VAD and transcription approach, model sources | MIT | https://github.com/cjpais/Handy |
| transcribe-cpp (and transcribe-cpp-sys) | GGUF Whisper and Parakeet inference | MIT | https://github.com/handy-computer/transcribe.cpp |
| handy-recorder | Microphone capture | MIT | https://github.com/handy-computer/handy-recorder |
| earshot | Voice activity detection | MIT OR Apache-2.0 | https://github.com/pykeio/earshot |
| ripgrep | File and text search in the desktop app (not part of the dictation engine) | Unlicense OR MIT | https://github.com/BurntSushi/ripgrep |
| ggml (vendored by transcribe-cpp-sys) | Tensor runtime | MIT | https://github.com/ggml-org/ggml |

## Handy

https://github.com/cjpais/Handy

```text
MIT License

Copyright (c) 2025 CJ Pais

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

## transcribe-cpp

Crates `transcribe-cpp` and `transcribe-cpp-sys` 0.4, https://github.com/handy-computer/transcribe.cpp. They vendor ggml (MIT, Copyright (c) 2023-2026 The ggml authors), Silero VAD (MIT, Copyright (c) 2020-present Silero Team) and miniz (MIT); see the crate's `THIRD-PARTY-LICENSES.md`.

```text
MIT License

Copyright (c) 2026 The transcribe.cpp authors

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

## handy-recorder

Crate `handy-recorder` 0.1, https://github.com/handy-computer/handy-recorder (extracted from Handy).

```text
MIT License

Copyright (c) 2026 handy-computer

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

## ripgrep

Binary `rg` 15.1.0, https://github.com/BurntSushi/ripgrep, by Andrew Gallant, shipped unmodified
in the desktop app under `resources/ripgrep/` and used under the MIT licence of its
`Unlicense OR MIT` dual licence. The MIT terms are the permission notice reproduced above,
with copyright held by Andrew Gallant.

## earshot

Crate `earshot` 1.2, https://github.com/pykeio/earshot, used under the MIT licence of its
`MIT OR Apache-2.0` dual licence. The MIT terms are the permission notice reproduced above,
with copyright held by the earshot authors.
