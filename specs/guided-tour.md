# Guided Tour with React Joyride

## Overview

Add an interactive guided tour to Ollamable using [React Joyride](https://react-joyride.com/) (v3, MIT license, ~37 kB gzipped). The tour walks first-time users through every interactive element in the interface by seeding two example conversations that exercise the full feature set: system prompts, multi-turn chat, reasoning steps, tool calls/results, meta events, and model metadata.

A **Take Tour** button in the left sidebar (bottom, styled as a section heading) lets users replay the tour at any time.

---

## Goals

1. **Teach every interactive element** — users complete the tour knowing how to use the entire UI
2. **Show realistic data** — two pre-built conversations demonstrate real interaction patterns
3. **Non-intrusive** — auto-triggers only on first visit; easily dismissed; replayable from sidebar
4. **Educational alignment** — the project exists for learning; the tour reinforces that by explaining *why* each element exists, not just *what* it does

---

## Dependencies

```
npm install react-joyride
```

React Joyride v3 supports React 19 and SSR (Next.js safe). No additional peer dependencies required.

---

## Tour State & Persistence

### localStorage keys

| Key | Type | Purpose |
|-----|------|---------|
| `ollamable.tourCompleted` | `boolean` | `true` after user finishes or skips the tour |
| `ollamable.tourStep` | `number` | Current step index (for resume after refresh) |

### State hook

Create a `useTour` hook (or integrate directly into `ChatWorkspace`) managing:

```ts
interface TourState {
  run: boolean;          // Joyride run prop
  stepIndex: number;     // current step
  tourCompleted: boolean;
}
```

- On mount: if `ollamable.tourCompleted` is falsy, set `run: true`
- On tour complete/skip: set `ollamable.tourCompleted = true`, remove tour step key
- "Take Tour" button: reset `run: true`, `stepIndex: 0`

---

## Example Conversations (Tour Data)

Two conversations are seeded into state when the tour starts. They are **removed** when the tour ends (unless the user has modified them). They use the model name of whatever model is currently selected (or the first fallback model).

### Conversation 1: "What is the Fibonacci sequence?"

A basic multi-turn conversation demonstrating system prompts, user/assistant messages, reasoning, and token metadata.

| Step | Kind | Content summary |
|------|------|-----------------|
| 1 | `system` | "You are a helpful math tutor. Explain concepts step by step." |
| 2 | `user` | "What is the Fibonacci sequence?" |
| 3 | `reasoning` | (Internal chain-of-thought about how to explain the sequence) |
| 4 | `assistant` | Multi-paragraph explanation with the first 10 numbers, the recurrence relation, and a mention of the golden ratio. Includes `usage: { inputTokens: 42, outputTokens: 187, stopReason: "stop" }` |
| 5 | `user` | "Can you show me a Python function for it?" |
| 6 | `assistant` | Code block with a Python `fibonacci(n)` generator. Includes `usage: { inputTokens: 238, outputTokens: 95, stopReason: "stop" }` |

**Properties set on conversation:**
- `title`: "What is the Fibonacci sequence?"
- `titleEdited`: false
- `temperature`: 0.6
- `maxOutputTokens`: 500
- `systemPrompt`: "You are a helpful math tutor. Explain concepts step by step."
- `activeToolIds`: [] (no tools active)

### Conversation 2: "Search for the latest SpaceX launch"

A tool-use conversation demonstrating web search tool calls, tool results, meta events, and multi-step tool loops.

| Step | Kind | Content summary |
|------|------|-----------------|
| 1 | `system` | "You are a research assistant with access to web search. Always cite your sources." |
| 2 | `user` | "What was the most recent SpaceX launch?" |
| 3 | `meta` | `metaEvent: { kind: "search_start", title: "Web Search", detail: "Searching: latest SpaceX launch 2026" }` |
| 4 | `tool_call` | `toolCall: { name: "web_search", arguments: { query: "latest SpaceX launch 2026", count: 3 } }` |
| 5 | `meta` | `metaEvent: { kind: "search_result", title: "Search Complete", detail: "3 results returned", durationMs: 420 }` |
| 6 | `tool_result` | `toolResult: { name: "web_search" }`, content: JSON array of 3 mock search results with titles, URLs, snippets |
| 7 | `reasoning` | (Internal reasoning synthesizing the search results) |
| 8 | `assistant` | Summary paragraph citing the mock sources. Includes `usage: { inputTokens: 312, outputTokens: 156, stopReason: "stop" }` |

**Properties set on conversation:**
- `title`: "Search for the latest SpaceX launch"
- `titleEdited`: false
- `temperature`: 0.3
- `maxOutputTokens`: 1000
- `systemPrompt`: "You are a research assistant with access to web search. Always cite your sources."
- `activeToolIds`: includes the `web_search` tool ID (if available)

---

## Tour Steps

Each step targets an element via CSS selector. Steps are grouped into logical sections. Joyride `placement` is specified where auto-placement would be wrong.

### Data attribute requirements

Add `data-tour="<id>"` attributes to targeted elements in `chat-workspace.tsx` for stable selectors. This avoids coupling to MUI class names.

### Step sequence

The tour begins on Conversation 1 (selected). Steps marked with **[switch]** require a callback to change UI state (select conversation, expand section, etc.) before the step renders.

#### Section A: App Bar

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 1 | `[data-tour="appbar"]` | bottom | Welcome to Ollamable | This is your workspace for exploring how LLMs process conversations. Every request and response is broken into visible steps so you can see exactly what happens under the hood. |
| 2 | `[data-tour="model-chip"]` | bottom | Active Model | This chip shows which model is handling the current conversation. Click it to view detailed model metadata — parameter count, quantization, capabilities, and the full Modelfile. |
| 3 | `[data-tour="tools-chip"]` | bottom | Active Tools | When tools are enabled for a conversation, this chip shows the count. Click it to jump to the Tools panel on the right. |
| 4 | `[data-tour="color-mode-toggle"]` | bottom-end | Color Mode | Toggle between light, system, and dark themes. |

#### Section B: Left Sidebar — Conversations

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 5 | `[data-tour="sidebar"]` | right | Conversations Sidebar | All your conversations live here. Each card shows the message count, tool usage, token totals, and last-updated timestamp. |
| 6 | `[data-tour="new-chat"]` | right | New Chat | Click the pencil icon to start a fresh conversation. Each conversation has its own model, temperature, tool set, and system prompt. |
| 7 | `[data-tour="conversation-card"]` | right | Conversation Card | Click a conversation to select it. Click the title text to rename it. Hover to reveal the inspect (eye) and delete buttons. |
| 8 | `[data-tour="sidebar-toggle"]` | right | Collapse Sidebar | Toggle the sidebar open or closed to give the chat area more room. The sidebar state is remembered across sessions. |

#### Section C: System Prompt

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 9 | `[data-tour="system-prompt"]` | bottom | System Prompt | This is the system-level instruction sent before any user message. It shapes the model's behavior for the entire conversation. Try changing it and resending to see how responses differ. |

#### Section D: Transcript Area

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 10 | `[data-tour="transcript"]` | top | Message Transcript | Every exchange is broken into discrete steps. Each step card is color-coded by kind: blue for user, green for assistant, amber for reasoning, orange for tool calls, red for tool results. |
| 11 | `[data-tour="step-user"]` | left | User Message | Your messages appear as blue cards. Click the expand/collapse toggle to save space, or click the edit icon to modify and resend a message from any point in the conversation. |
| 12 | `[data-tour="step-assistant"]` | left | Assistant Response | The model's replies appear as green cards. The footer shows token counts (input/output) and the stop reason. Click the regenerate icon to get a different response. |
| 13 | `[data-tour="step-reasoning"]` | left | Reasoning / Thinking | When a model supports chain-of-thought, its internal reasoning appears as amber cards. This is the "thinking" the model does before producing a visible answer — normally hidden in other chat UIs. |

#### Section E: Composer

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 14 | `[data-tour="composer"]` | top | Composer | Type your message here and press Enter to send (Shift+Enter for newlines). During streaming, a stop button appears to cancel the response. The composer label changes to "Tool result" when a tool call is awaiting manual input. |

#### Section F: Tool Use (switch to Conversation 2)

**[switch]** Before step 15: programmatically select Conversation 2.

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 15 | `[data-tour="step-tool-call"]` | left | Tool Call | When the model decides to use a tool, it emits a tool_call step showing the function name and arguments as JSON. The backend executes the call automatically if the tool is configured. |
| 16 | `[data-tour="step-tool-result"]` | left | Tool Result | After execution, the tool's response appears as a tool_result step. The model reads this result and incorporates it into its next reply. |
| 17 | `[data-tour="step-meta"]` | left | Meta Events | Meta events (cyan cards) track system-level activity: MCP server connections, search dispatches, and timing data. These give you full visibility into what happens behind the scenes. |

#### Section G: Right Sidebar — Settings

**[switch]** Before step 18: open the right sidebar.

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 18 | `[data-tour="right-sidebar"]` | left | Settings Panel | The right sidebar holds all conversation-level settings: model selection, temperature, output limits, and tool configuration. |

**[switch]** Before step 19: expand the Models section.

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 19 | `[data-tour="models-section"]` | left | Models | Browse and select from all available models. Models are grouped by provider (Ollama, MiniMax, etc.). Use the search box to filter, or toggle "show reasoning only" to find models with chain-of-thought support. |
| 20 | `[data-tour="model-search"]` | left | Model Search | Type to filter the model list by name. Useful when you have many models installed. |
| 21 | `[data-tour="model-filter-reasoning"]` | left | Reasoning Filter | Enable this to show only models that support visible chain-of-thought reasoning (the amber thinking steps). |

**[switch]** Before step 22: collapse Models, expand Temperature.

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 22 | `[data-tour="temperature-section"]` | left | Temperature | Temperature controls randomness. Low values (0.0 - 0.3) produce focused, deterministic answers. High values (1.2+) produce creative, varied responses. Click a chip to set the temperature for this conversation. |

**[switch]** Before step 23: collapse Temperature, expand Max Output Tokens.

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 23 | `[data-tour="max-tokens-section"]` | left | Max Output Tokens | Limit how many tokens the model can produce in a single response. Useful for keeping answers concise or for testing how models handle truncation. |

**[switch]** Before step 24: collapse Max Output Tokens, expand Tools.

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 24 | `[data-tour="tools-section"]` | left | Tools | Tools extend what the model can do. Each tool has a name, description, and a JSON schema defining its input parameters. Enable or disable tools per conversation using the checkboxes. |
| 25 | `[data-tour="tool-search"]` | left | Tool Search & Filters | Search tools by name, filter to active-only, or disable all tools at once. |
| 26 | `[data-tour="tool-card"]` | left | Tool Definition | Each tool card shows its name, description, and parameter schema. The checkbox toggles whether this tool is available to the model in the current conversation. Built-in tools (like web_search) and MCP-provided tools are listed in separate groups. |

#### Section H: Request JSON

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 27 | `[data-tour="conversation-card"]` | right | Inspect Request JSON | Hover over a conversation card and click the eye icon to see the exact OpenAI-compatible JSON payload that would be sent to the model. This is the raw API request — great for learning the chat completions format. |

#### Section I: Take Tour Button & Finish

| # | Target | Placement | Title | Content |
|---|--------|-----------|-------|---------|
| 28 | `[data-tour="take-tour"]` | right | Replay the Tour | You can restart this tour anytime by clicking "Take Tour" at the bottom of the sidebar. Happy exploring! |

---

## "Take Tour" Sidebar Button

### Location

Bottom of the left sidebar, below the conversations list, pushed to the bottom with `mt: "auto"`. Separated from the list by a subtle top border.

### Markup pattern

Follow the existing section heading pattern using `ListItemButton` + `Typography variant="overline"`:

```tsx
<ListItemButton
  data-tour="take-tour"
  onClick={handleStartTour}
  sx={{ mx: -1, px: 2, py: 1 }}
>
  <TourOutlinedIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />
  <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
    Take Tour
  </Typography>
</ListItemButton>
```

Use `TourOutlined` from `@mui/icons-material` (or `HelpOutlineOutlined` / `ExploreOutlined` as fallback if `TourOutlined` is unavailable in MUI 7).

### Visibility

- Always visible when the sidebar is expanded
- Hidden (opacity: 0, pointerEvents: none) when sidebar is collapsed
- Follows the same opacity transition as other sidebar content (`0.25s ease`)

---

## Joyride Configuration

### Component integration

Render `<Joyride />` inside `ChatWorkspace`, above the main layout Box:

```tsx
<Joyride
  steps={tourSteps}
  run={tourState.run}
  stepIndex={tourState.stepIndex}
  continuous
  showSkipButton
  showProgress
  disableOverlayClose
  scrollToFirstStep
  spotlightClicks
  callback={handleJoyrideCallback}
  locale={{
    back: "Back",
    close: "Close",
    last: "Finish",
    next: "Next",
    skip: "Skip tour",
  }}
  styles={{
    options: {
      zIndex: 10000,
      primaryColor: "#2457d6",        // matches theme primary
      textColor: "var(--mui-palette-text-primary)",
      backgroundColor: "var(--mui-palette-background-paper)",
    },
    tooltip: {
      borderRadius: 18,               // matches theme shape
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    },
  }}
  floaterProps={{
    disableAnimation: false,
  }}
/>
```

### Callback handler

The `handleJoyrideCallback` function handles:

1. **`STATUS.FINISHED` / `STATUS.SKIPPED`**:
   - Set `ollamable.tourCompleted = true` in localStorage
   - Clean up example conversations (remove if unmodified)
   - Set `run: false`

2. **`ACTION.NEXT` / `ACTION.PREV`**:
   - Update `stepIndex`
   - Before specific steps, execute UI state changes:
     - Step 15: select Conversation 2, ensure it's visible
     - Step 18: open right sidebar (`rightSidebarOpen: true`)
     - Step 19: expand Models section (`modelSectionOpen: true`)
     - Step 22: collapse Models, expand Temperature
     - Step 23: collapse Temperature, expand Max Tokens
     - Step 24: collapse Max Tokens, expand Tools
   - Persist `stepIndex` to localStorage for resume

3. **`ACTION.CLOSE`**:
   - Same as FINISHED

### Step change orchestration

Some steps need a brief delay after UI state changes (sidebar animation is 350ms). Use Joyride's `beforeStep` event or a `setTimeout(update, 400)` to wait for transitions before advancing.

---

## Data Attributes to Add

Add `data-tour` attributes to these elements in `chat-workspace.tsx`:

| Attribute | Element | Location (approx. line) |
|-----------|---------|------------------------|
| `data-tour="appbar"` | `<AppBar>` | 968 |
| `data-tour="model-chip"` | Model `<Chip>` | 988 |
| `data-tour="tools-chip"` | Tools `<Chip>` | 998 |
| `data-tour="color-mode-toggle"` | `<ColorModeToggle>` wrapper | 1006 |
| `data-tour="sidebar"` | Left sidebar `<Paper>` | 1011 |
| `data-tour="sidebar-toggle"` | Collapse `<IconButton>` | 1056 |
| `data-tour="new-chat"` | New Chat `<Stack>` | 1065 |
| `data-tour="conversation-card"` | First conversation `<Paper>` (dynamic) | 1098 |
| `data-tour="system-prompt"` | System prompt `<TextField>` | (in center area) |
| `data-tour="transcript"` | Transcript scroll container `<Box>` | (in center area) |
| `data-tour="step-user"` | First user StepCard `<Paper>` | (dynamic, data-step-kind="user") |
| `data-tour="step-assistant"` | First assistant StepCard | (dynamic, data-step-kind="assistant") |
| `data-tour="step-reasoning"` | First reasoning StepCard | (dynamic, data-step-kind="reasoning") |
| `data-tour="step-tool-call"` | First tool_call StepCard | (dynamic, data-step-kind="tool_call") |
| `data-tour="step-tool-result"` | First tool_result StepCard | (dynamic, data-step-kind="tool_result") |
| `data-tour="step-meta"` | First meta StepCard | (dynamic, data-step-kind="meta") |
| `data-tour="composer"` | Composer container `<Box>` | (data-composer-mode) |
| `data-tour="right-sidebar"` | Right sidebar `<Paper>` | (right side) |
| `data-tour="models-section"` | Models section `<Box>` | (inside right sidebar) |
| `data-tour="model-search"` | Model search `<SectionSearchField>` | (inside Models) |
| `data-tour="model-filter-reasoning"` | Reasoning filter `<Chip>` | (inside Models) |
| `data-tour="temperature-section"` | Temperature section `<Box>` | (inside right sidebar) |
| `data-tour="max-tokens-section"` | Max tokens section `<Box>` | (inside right sidebar) |
| `data-tour="tools-section"` | Tools section `<Box>` | (inside right sidebar) |
| `data-tour="tool-search"` | Tool search + filter chips area | (inside Tools) |
| `data-tour="tool-card"` | First tool `<Paper>` card | (inside Tools) |
| `data-tour="take-tour"` | Take Tour `<ListItemButton>` | (bottom of left sidebar) |

For dynamic step cards (user, assistant, reasoning, tool_call, tool_result, meta): apply `data-tour` to the **first** matching StepCard in the currently rendered transcript. This can be done by checking the index during the step render loop.

---

## File Changes

| File | Change |
|------|--------|
| `package.json` | Add `react-joyride` dependency |
| `src/components/chat-workspace.tsx` | Add `data-tour` attributes to elements, render `<Joyride />`, add "Take Tour" button to left sidebar, add tour state management and callback handler |
| `src/lib/tour-data.ts` | **New file.** Export `tourSteps` array (Joyride `Step[]`), `createTourConversations()` factory function, and `TOUR_COMPLETED_KEY` / `TOUR_STEP_KEY` constants |
| `src/lib/chat.ts` | No changes needed (reuse `createStep`, `createId` for building tour conversations) |

### Consideration: component size

`chat-workspace.tsx` is already 2500 lines. The tour logic (state, callback, step definitions) should live in `src/lib/tour-data.ts` to avoid further bloating the component. The component only needs:
- `import { tourSteps, createTourConversations, TOUR_COMPLETED_KEY } from "@/src/lib/tour-data"`
- A `useTour()` state block (~20 lines)
- The `<Joyride />` element
- The "Take Tour" button markup
- `data-tour` attributes on existing elements

---

## Behavior Details

### First visit auto-start

1. On mount, check `localStorage.getItem("ollamable.tourCompleted")`
2. If falsy, call `createTourConversations(currentModel, availableTools)` to build the two example conversations
3. Prepend them to the conversations array, select Conversation 1
4. Set `run: true` after a 500ms delay (let the UI settle and models load)

### Tour conversations lifecycle

- Tour conversations are tagged with a `_tourExample: true` property on the `Conversation` object (add to type)
- On tour finish/skip: if a tour conversation's steps are unmodified (same length and content as seeded), remove it
- If the user has sent additional messages or edited steps, keep the conversation (they found it useful)

### Resume after refresh

- On mount, if `ollamable.tourCompleted` is falsy but `ollamable.tourStep` exists, resume from that step index
- Tour conversations should already be in localStorage from the initial seeding

### Sidebar state during tour

The tour callback manages sidebar/section state automatically:
- Left sidebar forced open for steps 5-8 and 27-28
- Right sidebar forced open for steps 18-26
- Individual sections expanded/collapsed as needed per step

The user's original sidebar state is **saved** before the tour starts and **restored** after it ends.

### Accessibility

- Joyride v3 provides ARIA labels, focus trapping, and keyboard navigation (Tab/Shift+Tab/Escape) out of the box
- Tour tooltip contrast meets WCAG AA against both light and dark backgrounds
- Skip button is always visible for keyboard users

### Responsive behavior

- On viewports < 768px wide, the tour should be deferred (not auto-triggered) since sidebars collapse and the experience would be cramped
- The "Take Tour" button remains available; clicking it on narrow viewports shows a message suggesting a wider screen for the best experience

---

## Testing

### Unit tests (Vitest)

- `tour-data.test.ts`: verify `createTourConversations()` returns 2 valid conversations with all expected step kinds
- `tour-data.test.ts`: verify `tourSteps` array has correct length and all targets are valid selector strings

### E2E tests (Playwright)

- Tour auto-starts on first visit (no `ollamable.tourCompleted` in storage)
- Tour does NOT auto-start when `ollamable.tourCompleted` is `true`
- Clicking "Next" advances through all steps without errors
- Clicking "Skip" ends the tour and sets `ollamable.tourCompleted`
- "Take Tour" button restarts the tour
- Tour conversations are cleaned up on finish
- Tour conversations are kept if user has modified them

---

## Open Questions

1. **Icon choice**: MUI 7 may or may not include `TourOutlined`. Verify availability; fall back to `ExploreOutlined` or `HelpOutlineOutlined`.
2. **Tooltip theming**: Should tour tooltips use the glassmorphism backdrop-blur style to match the app's paper surfaces, or stay opaque for readability?
3. **Step content length**: The step descriptions above are concise. Should they include animated GIFs or static illustrations for complex interactions (e.g., editing a message, tool loop flow)?
