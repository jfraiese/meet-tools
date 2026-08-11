# Third-party components

Nothing here is bundled. The install scripts download these at setup time and
they land in `~/.cache`; this file records what they are and what their licences
require, because redistributing a transcript is one thing and redistributing a
model is another.

| Component | Licence | Fetched by |
| --- | --- | --- |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | you, via Homebrew |
| [Whisper `ggml-large-v3`](https://huggingface.co/ggerganov/whisper.cpp) | Apache 2.0 | you, via curl |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (diarizer binary) | Apache 2.0 | `install-diarizer.js` |
| [pyannote segmentation 3.0](https://huggingface.co/pyannote/segmentation-3.0) | MIT | `install-diarizer.js` |
| [NVIDIA NeMo TitaNet-large](https://huggingface.co/nvidia/speakerverification_en_titanet_large) | **CC-BY-4.0** | `install-diarizer.js` |
| [Silero VAD](https://huggingface.co/ggml-org/whisper-vad) | MIT | `install-diarizer.js` |

## Attribution

**NVIDIA TitaNet-large is CC-BY-4.0, which requires attribution.** If you
publish speaker-labelled output produced by this tool, credit the model. The
other components are permissive and ask for nothing beyond retaining their
notices, which downloading rather than vendoring already satisfies.

The pyannote model is fetched from sherpa-onnx's release page rather than from
HuggingFace directly, which is why no HuggingFace account or access token is
needed to install speaker labelling.

`ffmpeg`, which you install yourself via Homebrew, is LGPL or GPL depending on
how that build was configured. This project shells out to it as a separate
process and does not link against it.
