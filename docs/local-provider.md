# Local provider

`JEV_PROVIDER=local` sends requests to a System One-compatible server that you run on
your own machine or network. No request goes to a cloud service and there is no
per-request cost. This server does not start or manage the local server; you run it
separately.

Verified on 2026-10-07 with llama.cpp's `llama-server` serving Cloudflare's Clef Flash
on Windows 11 with an NVIDIA RTX 4070 Ti (12 GB).

## Setup with llama.cpp and Clef Flash

### 1. Download llama.cpp

From a recent build at https://github.com/ggml-org/llama.cpp/releases (Clef support
landed on 2026-10-03, Clef image input on 2026-10-05), download the files for your
platform. On Windows with an NVIDIA driver that supports CUDA 13.x:

| File | SHA-256 (build b11462) |
| --- | --- |
| `llama-b11462-bin-win-cuda-13.4-x64.zip` | `2228d1ed1b3ecd05e5e5003b19ad53a09ad726210fe8ff1f4997433124f144d5` |
| `cudart-llama-bin-win-cuda-13.4-x64.zip` | `738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668` |

Unzip both into the same folder. GitHub shows the SHA-256 of every release file.

### 2. Download the model

From https://huggingface.co/ggml-org/Clef-Flash-GGUF (llama.cpp's own conversion; the
decision head is included):

| File | Size | SHA-256 |
| --- | --- | --- |
| `Clef-Flash-Q4_K_M.gguf` | 6.5 GB | `fd3e90605e8103307dca37cb5a8cdb036267e2fe3cb2d908d80a8ceb9ec0638c` |
| `mmproj-Clef-Flash-Q8_0.gguf` (images) | 0.6 GB | `3fbc646617c56c35ba48e06f0fbe8693a83bde49eb31e2a3bf59ba0a308c9e25` |

Q4_K_M plus the image projector use about 8 GB of GPU memory with the settings
below. `Clef-Flash-Q8_0.gguf` (9.7 GB) needs a larger GPU.

### 3. Start the server

```bash
llama-server -m Clef-Flash-Q4_K_M.gguf --mmproj mmproj-Clef-Flash-Q8_0.gguf \
  --alias clef-flash --host 127.0.0.1 --port 8097 \
  -ngl 99 -c 8192 -b 8192 -ub 8192 -np 1 --no-webui
```

- `-ub 8192 -b 8192` is required. llama.cpp evaluates a Clef request in one batch,
  so the whole prompt must fit in `--ubatch-size`; the default of 512 tokens is too
  small for a single photo (about 750 to 2,000 tokens each).
- `-c 8192` caps the request size. Raise it with `-b` and `-ub` if you send longer
  input and have GPU memory to spare.
- `--host 127.0.0.1` keeps the server reachable from this machine only.
- Port 8097 avoids 8080, llama-server's default, which other tools (for example
  OpenAI's `tunnel-client` health check) often use.
- `--alias clef-flash` gives the model the name used in `JEV_MODEL`.

The server is ready when `http://127.0.0.1:8097/health` returns `{"status":"ok"}`.

### 4. Configure jev-mcp

```
JEV_PROVIDER=local
JEV_LOCAL_BASE_URL=http://127.0.0.1:8097
JEV_MODEL=clef-flash
JEV_IMAGE_DIRS=D:/inspections
```

`JEV_LOCAL_API_KEY` is only needed if you start llama-server with `--api-key`.

## Behavior

| Item | Behavior |
| --- | --- |
| Request | TypeSafe System One format at `POST /v1/systemone` |
| Images | Sent in the server's `images` field as data URLs ([llama-server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), "POST /v1/systemone") |
| Image capability | Taken from `GET /v1/models` (`architecture.input_modalities` contains `image` when `--mmproj` is loaded) |
| WebP | Rejected before sending: llama-server answers WebP with HTTP 500 "Failed to load image or audio file". PNG and JPEG work |
| Model names | `jev.models` lists the server's decision models by ID; the server reports no descriptions or release dates, so none are shown |
| Cost | Not reported (`usage.costUsd` absent) |
| Errors | OpenAI-style `{ "error": { "code", "message", "type" } }`; 503 "Loading model" is retried |

Clef's cloud limits do not apply: the local server accepted a 610 KB photo, question
IDs in Korean, a single-option choice and 65 questions in one request. The image
count is still limited to 4 by this server's own validation.

## Measured results (Q4_K_M, RTX 4070 Ti)

| Check | Local Clef Flash | Cloud Clef Flash (OpenRouter) |
| --- | --- | --- |
| "Help! My payouts have been failing for 3 days." urgent | 0.84 | 0.85 |
| Department `billing` probability | 0.785 | 0.782 |
| Frustration score | 1.10 | 1.15 |
| Repeated identical requests | Identical answers | Not tested |
| Latency, text | 0.08 to 0.09 s (0.37 s first request) | about 0.75 s |
| Real photos (5 JPEGs, 27 scored items) | 27/27 | 30/30 on 6 photos |
| Four photos in one request, position questions | Correct (0.94 to 0.95) | Correct |

The 4-bit model gave nearly the same probabilities as the cloud model on these
checks. This is a small sample; check accuracy on your own labeled data.

## Tests

`npm run test:contract` and `npm run test:e2e` include local-server tests that run
only when `JEV_LOCAL_BASE_URL/health` answers. Start the server first to run them.
