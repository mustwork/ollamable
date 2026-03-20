# Ollamable

A browser-based chat interface for local LLMs powered by [Ollama](https://ollama.com). Built with Next.js, React, and Material UI.

This project is a **demo for educational purposes** — it exposes the internals of how LLMs actually work under the hood so you can learn by watching.

## What you can learn

- **Tool/function calling** — see how models request tool invocations, how arguments are structured, and how results flow back into the conversation
- **Reasoning/thinking** — watch the model's chain-of-thought reasoning appear in real time as a separate step, distinct from the final answer
- **Message roles** — understand how system, user, assistant, tool_call, and tool_result steps combine to form the full conversation protocol
- **Streaming** — observe NDJSON streaming from the Ollama API as deltas arrive and assemble into complete responses
- **Request/response inspection** — preview the exact JSON payload sent to Ollama before each request, including message history, tool definitions, and model parameters

## Features

- Chat with any model available in your local Ollama instance
- Define custom tools with JSON Schema and toggle them per conversation
- Step-level transcript showing every role in the conversation
- Real-time streaming with reasoning and tool call visualization
- Request JSON preview panel
- Light and dark mode
- Temperature control
- Conversation history with persistence

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Ollama](https://ollama.com) running locally on the default port (11434)

## Getting Started

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## License

[MIT](LICENSE)
