# Guided Tour with React Joyride — Acceptance Criteria

## Story 1: Tour data module and dependency (s1-tour-data)

### AC-1: react-joyride dependency installed
- `react-joyride` is listed in `package.json` under `dependencies`
- `npm install` succeeds without errors
- The package resolves to v3.x (React 19 / Next.js SSR compatible)

### AC-2: TOUR_COMPLETED_KEY and TOUR_STEP_KEY constants exported
- `src/lib/tour-data.ts` exports `TOUR_COMPLETED_KEY` with value `"ollamable.tourCompleted"`
- `src/lib/tour-data.ts` exports `TOUR_STEP_KEY` with value `"ollamable.tourStep"`

### AC-3: tourSteps array exported
- `src/lib/tour-data.ts` exports a `tourSteps` array of Joyride `Step` objects
- The array contains exactly 28 steps (steps 1-28 from the spec)
- Every step has a `target` that is a valid CSS attribute selector string matching `[data-tour="..."]`
- Every step has `title` (string) and `content` (string) matching the spec
- Steps that specify `placement` in the spec include the correct `placement` value

### AC-4: createTourConversations factory function exported
- `src/lib/tour-data.ts` exports `createTourConversations(model: string, tools: ToolDefinition[]): Conversation[]`
- It returns an array of exactly 2 `Conversation` objects
- Both conversations have `_tourExample: true` set

### AC-5: Tour Conversation 1 — "What is the Fibonacci sequence?"
- `createTourConversations()[0]` has:
  - `title`: `"What is the Fibonacci sequence?"`
  - `titleEdited`: `false`
  - `temperature`: `0.6`
  - `maxOutputTokens`: `500`
  - `systemPrompt`: `"You are a helpful math tutor. Explain concepts step by step."`
  - `activeToolIds`: `[]`
  - `model` set to the `model` parameter passed in
  - `_tourExample`: `true`
- Steps array contains 6 steps with kinds in order: `system`, `user`, `reasoning`, `assistant`, `user`, `assistant`
- The two `assistant` steps include `usage` objects with `inputTokens`, `outputTokens`, and `stopReason`

### AC-6: Tour Conversation 2 — "Search for the latest SpaceX launch"
- `createTourConversations()[1]` has:
  - `title`: `"Search for the latest SpaceX launch"`
  - `titleEdited`: `false`
  - `temperature`: `0.3`
  - `maxOutputTokens`: `1000`
  - `systemPrompt`: `"You are a research assistant with access to web search. Always cite your sources."`
  - `model` set to the `model` parameter passed in
  - `_tourExample`: `true`
- Steps array contains 8 steps with kinds in order: `system`, `user`, `meta`, `tool_call`, `meta`, `tool_result`, `reasoning`, `assistant`
- The `meta` steps include properly structured `metaEvent` payloads (with `kind`, `title`, `detail`)
- The `tool_call` step includes a `toolCall` payload with `name: "web_search"` and `arguments`
- The `tool_result` step includes a `toolResult` payload with `name: "web_search"` and JSON content
- The `assistant` step includes a `usage` object

### AC-7: _tourExample property added to Conversation type
- `src/types/chat.ts` `Conversation` interface includes `_tourExample?: boolean`

### AC-8: Unit tests pass for tour data module
- `tests/unit/tour-data.test.ts` exists and passes via `npx vitest run`
- Tests verify `tourSteps` has length 28 and all targets are valid `[data-tour="..."]` selector strings
- Tests verify `createTourConversations()` returns 2 conversations
- Tests verify Conversation 1 has 6 steps with correct kinds
- Tests verify Conversation 2 has 8 steps with correct kinds
- Tests verify both conversations have `_tourExample: true`
- Tests verify step content is non-empty for user and assistant steps

---

## Story 2: Data-tour attributes and Take Tour button (s2-data-tour-attrs)

### AC-9: AppBar data-tour attributes
- The `<AppBar>` element in `chat-workspace.tsx` has `data-tour="appbar"`
- The model `<Chip>` has `data-tour="model-chip"`
- The `<ColorModeToggle>` wrapper has `data-tour="color-mode-toggle"`

### AC-10: Tools chip in AppBar (if active tools exist)
- When the selected conversation has active tools, a `<Chip>` with `data-tour="tools-chip"` is rendered in the AppBar toolbar showing the active tool count
- Clicking it opens the right sidebar with the tools section expanded

### AC-11: Left sidebar data-tour attributes
- The left sidebar `<Paper>` has `data-tour="sidebar"`
- The sidebar collapse `<IconButton>` has `data-tour="sidebar-toggle"`
- The "New Chat" `<Stack>` (containing the label and pencil icon) has `data-tour="new-chat"`
- The first conversation `<Paper>` card (in the rendered list of conversations with user messages) has `data-tour="conversation-card"`

### AC-12: Center area data-tour attributes
- The system prompt `<TextField>` (or its wrapper) has `data-tour="system-prompt"`
- The transcript scroll container `<Box>` has `data-tour="transcript"`
- The composer container `<Box>` (the one with `data-composer-mode`) has `data-tour="composer"`

### AC-13: Step card data-tour attributes
- In the `visibleTranscriptSteps.map(...)` render loop, the first `StepCard` whose `step.kind` is `"user"` gets `data-tour="step-user"` on its root `<Paper>`
- Similarly for `"assistant"` -> `data-tour="step-assistant"`, `"reasoning"` -> `data-tour="step-reasoning"`, `"tool_call"` -> `data-tour="step-tool-call"`, `"tool_result"` -> `data-tour="step-tool-result"`, `"meta"` -> `data-tour="step-meta"`
- Only the **first** occurrence of each kind gets the `data-tour` attribute
- Implementation approach: pass a `dataTour` prop to `StepCard` or set it via the render loop index tracking which kinds have been seen

### AC-14: Right sidebar data-tour attributes
- The right sidebar `<Paper>` has `data-tour="right-sidebar"`
- The Models section `<Box>` has `data-tour="models-section"`
- The `<SectionSearchField>` for models has `data-tour="model-search"`
- The "reasoning only" filter `<Chip>` has `data-tour="model-filter-reasoning"`
- The Temperature section `<Box>` has `data-tour="temperature-section"`
- The Max Output Tokens section `<Box>` has `data-tour="max-tokens-section"`
- The Tools section `<Box>` has `data-tour="tools-section"`
- The tool search + filter chips area has `data-tour="tool-search"`
- The first tool `<Paper>` card has `data-tour="tool-card"`

### AC-15: "Take Tour" button in left sidebar
- A `<ListItemButton>` with `data-tour="take-tour"` is rendered at the bottom of the left sidebar
- It uses `mt: "auto"` to push to the bottom and has a top border separator
- It contains an icon (from `@mui/icons-material`, e.g. `ExploreOutlined` or `HelpOutlineOutlined`) and `<Typography variant="overline">Take Tour</Typography>`
- It is visible when sidebar is expanded, hidden (opacity 0, pointerEvents none) when collapsed
- It follows the same opacity transition (`0.25s ease`) as other sidebar content
- Clicking it calls a `handleStartTour` callback (wired up in Story 3)

---

## Story 3: Joyride integration and tour state (s3-joyride-integration)

### AC-16: Joyride component rendered in ChatWorkspace
- `<Joyride>` is imported from `react-joyride` and rendered inside `ChatWorkspace`
- It is placed above the main layout `<Box>` in the JSX
- Props include: `steps={tourSteps}`, `run`, `stepIndex`, `continuous`, `showSkipButton`, `showProgress`, `disableOverlayClose`, `scrollToFirstStep`, `spotlightClicks`, `callback`, `locale`, `styles`, `floaterProps`
- Styles match the spec: `zIndex: 10000`, `primaryColor: "#2457d6"`, `borderRadius: 18`

### AC-17: Tour state management
- Tour state tracks `run: boolean`, `stepIndex: number`, `tourCompleted: boolean`
- On mount: if `localStorage.getItem("ollamable.tourCompleted")` is falsy, the tour auto-starts after a 500ms delay
- On mount: if `ollamable.tourCompleted` is falsy but `ollamable.tourStep` exists, resume from that step index
- `stepIndex` is persisted to `localStorage` under `TOUR_STEP_KEY` on each step change

### AC-18: Tour conversation seeding
- When the tour starts (auto or via "Take Tour" button):
  - `createTourConversations(currentModel, availableTools)` is called
  - The 2 tour conversations are prepended to the conversations array
  - Conversation 1 is selected
- The current model used is either the selected conversation's model or the first available model

### AC-19: Tour callback — step orchestration
- `handleJoyrideCallback` handles `ACTION.NEXT` and `ACTION.PREV` to update `stepIndex`
- Before step 15: programmatically select Conversation 2
- Before step 18: set `rightSidebarOpen: true`
- Before step 19: set `modelSectionOpen: true`
- Before step 22: collapse Models, expand Temperature (`modelSectionOpen: false`, `tempSectionOpen: true`)
- Before step 23: collapse Temperature, expand Max Tokens (`tempSectionOpen: false`, `maxTokensSectionOpen: true`)
- Before step 24: collapse Max Tokens, expand Tools (`maxTokensSectionOpen: false`, `toolsSectionOpen: true`)
- Step changes that trigger sidebar animations use a brief delay (~400ms) before advancing

### AC-20: Tour callback — finish/skip/close
- On `STATUS.FINISHED`, `STATUS.SKIPPED`, or `ACTION.CLOSE`:
  - `localStorage.setItem("ollamable.tourCompleted", "true")`
  - `localStorage.removeItem("ollamable.tourStep")`
  - `run` is set to `false`
  - Tour conversations with `_tourExample: true` are removed if their steps are unmodified (same length as seeded)
  - Tour conversations where the user added or modified steps are kept

### AC-21: "Take Tour" button wiring
- Clicking the "Take Tour" button (from AC-15):
  - Resets `tourCompleted` to `false` in localStorage
  - Seeds tour conversations (per AC-18)
  - Sets `run: true`, `stepIndex: 0`

### AC-22: Sidebar state save/restore during tour
- Before the tour starts, the current sidebar state (left open/closed, right open/closed, section states) is saved
- After the tour ends (finish/skip/close), the saved sidebar state is restored
- Left sidebar is forced open for steps 5-8 and 27-28
- Right sidebar is forced open for steps 18-26

### AC-23: Responsive behavior
- On viewports < 768px wide, the tour does not auto-trigger on first visit
- The "Take Tour" button remains visible; clicking it on narrow viewports displays a message suggesting a wider screen

### AC-24: No regressions
- All existing unit tests in `tests/unit/` continue to pass
- The application builds without TypeScript errors (`npx next build` or `npx tsc --noEmit`)
