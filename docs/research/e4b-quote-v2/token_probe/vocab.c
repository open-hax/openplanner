// SPDX-License-Identifier: GPL-3.0-or-later
// Metadata/vocabulary only. No context, tensor, GPU or inference API is called.
#include "llama.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

#define MAX_BYTES 65536
#define MAX_FRAMES 16

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    struct rlimit memory = {512UL << 20, 512UL << 20}, cpu = {15, 15};
    if (setrlimit(RLIMIT_AS, &memory) || setrlimit(RLIMIT_CPU, &cpu)) return 3;
    struct llama_model_params params = llama_model_default_params();
    params.vocab_only = true;
    params.use_mmap = false;
    params.n_gpu_layers = 0;
    ggml_backend_dev_t devices[] = {NULL};
    params.devices = devices;
    struct llama_model *model = llama_model_load_from_file(argv[1], params);
    if (!model) return 4;
    const struct llama_vocab *vocab = llama_model_get_vocab(model);
    int result = 0;
    for (int frame = 0; ; frame++) {
        unsigned char prefix[4];
        size_t got = fread(prefix, 1, sizeof(prefix), stdin);
        if (!got && feof(stdin)) break;
        if (got != sizeof(prefix) || frame >= MAX_FRAMES) { result = 5; break; }
        uint32_t n = (uint32_t)prefix[0] | (uint32_t)prefix[1] << 8
                   | (uint32_t)prefix[2] << 16 | (uint32_t)prefix[3] << 24;
        if (!n || n > MAX_BYTES) { result = 6; break; }
        char text[MAX_BYTES], decoded[4 * MAX_BYTES];
        llama_token full[MAX_BYTES], completion[MAX_BYTES];
        if (fread(text, 1, n, stdin) != n) { result = 7; break; }
        // The pinned Ollama renderer supplies BOS; native completion strips it
        // and asks the tokenizer to insert special tokens. Prove both ID paths.
        if (n < 5 || memcmp(text, "<bos>", 5) || !llama_vocab_get_add_bos(vocab)) {
            result = 8; break;
        }
        int32_t a = llama_tokenize(vocab, text, (int32_t)n, full, MAX_BYTES, false, true);
        int32_t b = llama_tokenize(vocab, text + 5, (int32_t)n - 5, completion, MAX_BYTES, true, true);
        if (a < 0 || b < 0) { result = 9; break; }
        int32_t bytes = llama_detokenize(vocab, full, a, decoded, sizeof(decoded), false, true);
        bool equal = a == b && !memcmp(full, completion, (size_t)a * sizeof(*full));
        bool roundtrip = bytes == (int32_t)n && !memcmp(text, decoded, n);
        printf("{\"prompt-tokens\":%d,\"completion-tokens\":%d,\"token-ids-equal\":%s,\"full-roundtrip\":%s}\n",
               a, b, equal ? "true" : "false", roundtrip ? "true" : "false");
    }
    llama_model_free(model);
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage)) return 10;
    fprintf(stderr, "probe-max-rss-kib=%ld\n", usage.ru_maxrss);
    return result;
}
