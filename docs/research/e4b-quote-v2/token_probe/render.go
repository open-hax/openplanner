// SPDX-License-Identifier: GPL-3.0-or-later
// Build in the pinned upstream Ollama module. Render only; no network or model.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/model/renderers"
)

func run() error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 65536), 65536)
	encoder := json.NewEncoder(os.Stdout)
	count := 0
	for scanner.Scan() {
		count++
		if count > 16 {
			return fmt.Errorf("request cap exceeded")
		}
		var request api.ChatRequest
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			return err
		}
		if request.Model != "gemma4:e4b" || request.Think == nil || request.Think.Bool() ||
			len(request.Messages) != 2 || len(request.Tools) != 0 ||
			request.Messages[0].Role != "system" || request.Messages[1].Role != "user" {
			return fmt.Errorf("only the frozen text request shape is supported")
		}
		for _, message := range request.Messages {
			if len(message.Images) != 0 || len(message.ToolCalls) != 0 || message.Thinking != "" {
				return fmt.Errorf("multimodal and tool content is unsupported")
			}
		}
		prompt, err := renderers.RenderWithRenderer("gemma4-small", request.Messages, nil, request.Think)
		if err != nil {
			return err
		}
		for _, message := range request.Messages {
			if !strings.Contains(prompt, message.Content) {
				return fmt.Errorf("message content changed")
			}
		}
		if err := encoder.Encode(map[string]string{"prompt": prompt}); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
