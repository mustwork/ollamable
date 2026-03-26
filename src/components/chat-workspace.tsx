"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CloudIcon from "@mui/icons-material/Cloud";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import MemoryIcon from "@mui/icons-material/Memory";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import SearchIcon from "@mui/icons-material/Search";
import StopIcon from "@mui/icons-material/Stop";
import SyncIcon from "@mui/icons-material/Sync";
import type { Conversation, ConversationStep, OllamaModel, OllamaModelMeta } from "@/src/types/chat";
import { configuredTools } from "@/src/config/tools";
import { ColorModeToggle } from "@/src/components/color-mode-toggle";
import {
  createConversation,
  createStep,
  fallbackModels,
  formatTimestamp,
  inferTitle,
  loadConversations,
  loadSelectedConversationId,
  saveConversations,
  saveSelectedConversationId,
} from "@/src/lib/chat";
import {
  buildOllamaChatBody,
  fetchAllModels,
  fetchModelMeta,
  fetchModels,
} from "@/src/lib/ollama";
import { useWebSocket } from "@/src/lib/use-websocket";
import { BackendClient, WS_URL } from "@/src/lib/backend-client";

const SIDEBAR_WIDTH = 320;
const APP_BAR_HEIGHT = 65;
const TEMPERATURE_OPTIONS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 2.0];

export function ChatWorkspace() {
  const theme = useTheme();
  const [models, setModels] = useState<OllamaModel[]>(fallbackModels);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [composerValue, setComposerValue] = useState("");
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [toolDraftName, setToolDraftName] = useState("");
  const [toolDraftDescription, setToolDraftDescription] = useState("");
  const [toolDraftSchema, setToolDraftSchema] = useState("{\n  \"type\": \"object\",\n  \"properties\": {}\n}");
  const [loadingModels, setLoadingModels] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>("");
  const [modelMetaOpen, setModelMetaOpen] = useState(false);
  const [requestJsonOpen, setRequestJsonOpen] = useState(false);
  const [requestJsonCopyState, setRequestJsonCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [modelMetaLoading, setModelMetaLoading] = useState(false);
  const [modelMetaError, setModelMetaError] = useState("");
  const [modelMeta, setModelMeta] = useState<OllamaModelMeta | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState("");
  const stopStreamRef = useRef<(() => void) | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const previousSelectedConversationIdRef = useRef<string>("");
  const previousHasStreamingStepsRef = useRef(false);
  const backendClientRef = useRef(new BackendClient());

  const handleWsMessage = useCallback(
    (data: unknown) => {
      backendClientRef.current.handleServerMessage(data);
    },
    []
  );

  const { send: wsSend, connected: wsConnected } = useWebSocket(WS_URL, handleWsMessage);

  useEffect(() => {
    const initialConversations = loadConversations(configuredTools);
    const selectedId = loadSelectedConversationId() ?? initialConversations[0]?.id ?? "";

    setConversations(initialConversations);
    setSelectedConversationId(selectedId);
  }, []);

  const availableModels = useMemo(() => {
    const filteredModels = models.filter((model) => !isEmbeddingModel(model));
    return filteredModels.length > 0 ? filteredModels : fallbackModels;
  }, [models]);

  useEffect(() => {
    if (conversations.length === 0) {
      return;
    }

    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (selectedConversationId) {
      saveSelectedConversationId(selectedConversationId);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      try {
        // Try the backend first — it aggregates all configured providers
        const remoteModels = await fetchAllModels();
        if (!cancelled && remoteModels.length > 0) {
          setModels(remoteModels);
          return;
        }
      } catch {
        // Backend unreachable — fall back to direct Ollama fetch
      }

      try {
        const ollamaModels = await fetchModels();
        if (!cancelled && ollamaModels.length > 0) {
          setModels(ollamaModels);
        }
      } catch {
        if (!cancelled) {
          setError("Could not reach the backend or Ollama. Using fallback model list.");
        }
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );
  const activeTools = useMemo(
    () =>
      selectedConversation?.availableTools.filter((tool) =>
        selectedConversation.activeToolIds.includes(tool.id)
      ) ?? [],
    [selectedConversation]
  );
  const visibleTranscriptSteps = useMemo(
    () => selectedConversation?.steps.filter(isVisibleTranscriptStep) ?? [],
    [selectedConversation]
  );
  const pendingToolCall = useMemo(
    () => (selectedConversation ? getPendingToolCallStep(selectedConversation) : null),
    [selectedConversation]
  );
  const requestJsonPreview = useMemo(() => {
    if (!selectedConversation) {
      return "";
    }

    const pendingMessage = pendingToolCall?.toolCall
      ? {
          role: "tool" as const,
          content: composerValue,
          toolName: pendingToolCall.toolCall.name,
        }
      : {
          role: "user" as const,
          content: composerValue,
        };

    return JSON.stringify(
      buildOllamaChatBody({
        conversation: selectedConversation,
        tools: activeTools,
        stream: true,
        pendingMessage,
      }),
      null,
      2
    );
  }, [activeTools, composerValue, pendingToolCall, selectedConversation]);

  useEffect(() => {
    if (!selectedConversation && conversations.length > 0) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversation]);

  useEffect(() => {
    setEditingStepId(null);
    setStepDraft("");
  }, [selectedConversationId]);

  useEffect(() => {
    if (!requestJsonOpen && requestJsonCopyState !== "idle") {
      setRequestJsonCopyState("idle");
    }
  }, [requestJsonCopyState, requestJsonOpen]);

  useEffect(() => {
    const currentConversationId = selectedConversation?.id ?? "";
    const hasStreamingSteps =
      selectedConversation?.steps.some((step) => step.id.startsWith("stream-")) ?? false;
    const selectedConversationChanged =
      previousSelectedConversationIdRef.current !== currentConversationId;
    const streamingStarted = hasStreamingSteps && !previousHasStreamingStepsRef.current;

    if (selectedConversationChanged || streamingStarted) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    previousSelectedConversationIdRef.current = currentConversationId;
    previousHasStreamingStepsRef.current = hasStreamingSteps;
  }, [selectedConversationId, selectedConversation?.steps]);

  useEffect(() => {
    if (!selectedConversation || availableModels.length === 0) {
      return;
    }

    // Try to find an exact (provider, model) match first, then fall back to name-only
    const exactMatch = availableModels.find(
      (m) =>
        m.name === selectedConversation.model &&
        m.provider === selectedConversation.provider
    );
    const nameMatch = availableModels.find(
      (m) => m.name === selectedConversation.model
    );
    const match = exactMatch ?? nameMatch;

    if (!match) {
      // Model not found at all — reset to first available
      updateConversation(selectedConversation.id, (conversation) => ({
        ...conversation,
        model: availableModels[0].name,
        provider: availableModels[0].provider,
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    // Repair missing or stale provider on migrated conversations
    if (selectedConversation.provider !== match.provider) {
      updateConversation(selectedConversation.id, (conversation) => ({
        ...conversation,
        provider: match.provider,
        updatedAt: new Date().toISOString(),
      }));
    }
  }, [availableModels, selectedConversation]);

  function updateConversation(
    id: string,
    updater: (conversation: Conversation) => Conversation
  ) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? updater(conversation) : conversation
      )
    );
  }

  function handleCreateConversation() {
    const firstModel = availableModels[0];
    const model = firstModel?.name ?? fallbackModels[0].name;
    const conversation = createConversation(model, configuredTools, firstModel?.provider);
    setConversations((current) => [conversation, ...current]);
    setSelectedConversationId(conversation.id);
    setComposerValue("");
  }

  function handleDeleteConversation(id: string) {
    setConversations((current) => {
      const remaining = current.filter((conversation) => conversation.id !== id);

      setSelectedConversationId((currentSelectedId) => {
        if (currentSelectedId !== id) {
          return currentSelectedId;
        }

        return remaining[0]?.id ?? "";
      });

      if (editingConversationId === id) {
        handleCancelTitleEdit();
      }

      if (selectedConversationId === id) {
        handleCancelStepEdit();
      }

      return remaining;
    });
  }

  function handleModelChange(compositeKey: string) {
    if (!selectedConversation) {
      return;
    }

    const { provider, model } = parseModelSelectKey(compositeKey);
    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      model,
      provider,
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleTemperatureChange(value: number | undefined) {
    if (!selectedConversation) {
      return;
    }

    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      temperature: value,
      updatedAt: new Date().toISOString(),
    }));
  }

  async function handleOpenModelMeta() {
    if (!selectedConversation) {
      return;
    }

    const model = availableModels.find(
      (entry) =>
        entry.name === selectedConversation.model &&
        entry.provider === selectedConversation.provider
    );
    if (!model) {
      return;
    }

    if (model.provider && model.provider !== "ollama") {
      setModelMetaOpen(true);
      setModelMetaLoading(false);
      setModelMetaError(`Model metadata is only available for Ollama models.`);
      setModelMeta(null);
      return;
    }

    setModelMetaOpen(true);
    setModelMetaLoading(true);
    setModelMetaError("");
    setModelMeta(null);

    try {
      const nextMeta = await fetchModelMeta(model);
      setModelMeta(nextMeta);
    } catch {
      setModelMetaError("Failed to load model metadata from Ollama.");
    } finally {
      setModelMetaLoading(false);
    }
  }

  function handleStartTitleEdit(conversation: Conversation) {
    setEditingConversationId(conversation.id);
    setTitleDraft(conversation.title);
  }

  function handleCancelTitleEdit() {
    setEditingConversationId(null);
    setTitleDraft("");
  }

  function handleStartStepEdit(step: ConversationStep) {
    if (!selectedConversation || step.kind !== "user" || streaming) {
      return;
    }

    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      steps: conversation.steps.map((conversationStep) =>
        conversationStep.id === step.id
          ? { ...conversationStep, expanded: true }
          : conversationStep
      ),
    }));
    setEditingStepId(step.id);
    setStepDraft(step.content);
  }

  function handleCancelStepEdit() {
    setEditingStepId(null);
    setStepDraft("");
  }

  function handleSaveTitle(id: string) {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      handleCancelTitleEdit();
      return;
    }

    updateConversation(id, (conversation) => ({
      ...conversation,
      title: nextTitle,
      titleEdited: true,
      updatedAt: new Date().toISOString(),
    }));
    handleCancelTitleEdit();
  }

  function applyDelta(conversationId: string, partialSteps: ConversationStep[]) {
    updateConversation(conversationId, (conversation) => {
      const stableSteps = conversation.steps.filter(
        (step) =>
          !step.id.startsWith("stream-") &&
          (step.kind === "system" ||
            step.kind === "user" ||
            step.kind === "assistant" ||
            step.kind === "reasoning" ||
            step.kind === "tool_call" ||
            step.kind === "tool_result" ||
            step.kind === "meta")
      );

      const nextStreamingSteps = partialSteps.map((step) => ({
        ...step,
        id: `stream-${step.id}`,
        expanded: true,
      }));

      return {
        ...conversation,
        steps: [...stableSteps, ...nextStreamingSteps],
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function applyMetaEvent(conversationId: string, metaStep: ConversationStep) {
    updateConversation(conversationId, (conversation) => {
      // Insert meta step before streaming steps so it appears above the current stream
      const streamingIdx = conversation.steps.findIndex((s) => s.id.startsWith("stream-"));
      const insertIdx = streamingIdx === -1 ? conversation.steps.length : streamingIdx;
      const nextSteps = [...conversation.steps];
      nextSteps.splice(insertIdx, 0, metaStep);
      return {
        ...conversation,
        steps: nextSteps,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async function streamConversationResponse(
    nextConversation: Conversation,
    options?: { prompt?: string }
  ) {
    setError("");
    setStreaming(true);

    const activeTools = nextConversation.availableTools.filter((tool) =>
      nextConversation.activeToolIds.includes(tool.id)
    );

    // Build the steps to send — include prompt as a user step if provided
    const stepsToSend = options?.prompt
      ? [
          ...nextConversation.steps,
          {
            id: `prompt-${Date.now()}`,
            kind: "user" as const,
            title: "User",
            content: options.prompt,
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ]
      : nextConversation.steps;

    if (!wsConnected) {
      setError("Backend is not connected. Make sure the server is running (make dev).");
      setStreaming(false);
      return;
    }

    const { promise, stop } = backendClientRef.current.startStream(wsSend, {
      conversationId: nextConversation.id,
      model: nextConversation.model,
      provider: nextConversation.provider,
      steps: stepsToSend,
      tools: activeTools,
      temperature: nextConversation.temperature,
      onDelta: (partialSteps) => applyDelta(nextConversation.id, partialSteps),
      onMetaEvent: (metaStep) => applyMetaEvent(nextConversation.id, metaStep),
    });
    stopStreamRef.current = stop;

    try {
      const responseSteps = await promise;
      updateConversation(nextConversation.id, (conversation) => ({
        ...conversation,
        steps: [
          ...conversation.steps.filter((step) => !step.id.startsWith("stream-")),
          ...responseSteps,
        ],
        updatedAt: new Date().toISOString(),
      }));
    } catch (streamError) {
      const isAbort =
        streamError instanceof Error && streamError.message === "AbortError";
      const message = isAbort
        ? "Generation stopped."
        : "Failed to stream from backend.";
      setError(message);
      updateConversation(nextConversation.id, (conversation) => ({
        ...conversation,
        steps: conversation.steps.filter((step) => !step.id.startsWith("stream-")),
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      stopStreamRef.current = null;
      setStreaming(false);
    }
  }

  async function handleSaveStepEdit(stepId: string) {
    if (!selectedConversation) {
      return;
    }

    const nextContent = stepDraft.trim();
    if (!nextContent) {
      handleCancelStepEdit();
      return;
    }

    const stepIndex = selectedConversation.steps.findIndex((step) => step.id === stepId);
    if (stepIndex === -1) {
      return;
    }

    const targetStep = selectedConversation.steps[stepIndex];
    if (targetStep.kind !== "user") {
      return;
    }

    const nextSteps = [
      ...selectedConversation.steps.slice(0, stepIndex),
      {
        ...targetStep,
        content: nextContent,
        expanded: true,
      },
    ];

    const nextConversation = {
      ...selectedConversation,
      title: selectedConversation.titleEdited
        ? selectedConversation.title
        : inferTitle(nextSteps),
      steps: nextSteps,
      updatedAt: new Date().toISOString(),
    };

    updateConversation(selectedConversation.id, () => nextConversation);

    handleCancelStepEdit();
    await streamConversationResponse(nextConversation);
  }

  async function handleRegenerateAssistantStep(stepId: string) {
    if (!selectedConversation || streaming) {
      return;
    }

    const stepIndex = selectedConversation.steps.findIndex((step) => step.id === stepId);
    if (stepIndex === -1) {
      return;
    }

    const targetStep = selectedConversation.steps[stepIndex];
    if (targetStep.kind !== "assistant") {
      return;
    }

    const responseStartIndex = findResponseStartIndex(selectedConversation.steps, stepIndex);
    const nextConversation = {
      ...selectedConversation,
      steps: selectedConversation.steps.slice(0, responseStartIndex),
      updatedAt: new Date().toISOString(),
    };

    updateConversation(selectedConversation.id, () => nextConversation);
    await streamConversationResponse(nextConversation);
  }

  function handlePromptChange(value: string) {
    if (!selectedConversation) {
      return;
    }

    updateConversation(selectedConversation.id, (conversation) => {
      const nextSteps = conversation.steps.map((step, index) =>
        index === 0 && step.kind === "system" ? { ...step, content: value } : step
      );

      return {
        ...conversation,
        systemPrompt: value,
        steps: nextSteps,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function handleToggleStep(stepId: string) {
    if (!selectedConversation) {
      return;
    }

    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      steps: conversation.steps.map((step) =>
        step.id === stepId ? { ...step, expanded: !step.expanded } : step
      ),
    }));
  }

  function handleToggleConversationTool(toolId: string) {
    if (!selectedConversation) {
      return;
    }

    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      activeToolIds: conversation.activeToolIds.includes(toolId)
        ? conversation.activeToolIds.filter((id) => id !== toolId)
        : [...conversation.activeToolIds, toolId],
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleAddTool() {
    if (!selectedConversation) {
      return;
    }

    const name = toolDraftName.trim();
    const description = toolDraftDescription.trim();
    const inputSchema = toolDraftSchema.trim();

    if (!name || !description || !inputSchema || toolDraftSchemaError) {
      return;
    }

    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tool"}-${Date.now()}`;

    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      availableTools: [
        ...conversation.availableTools,
        {
          id,
          name,
          description,
          inputSchema,
        },
      ],
      activeToolIds: [...conversation.activeToolIds, id],
      updatedAt: new Date().toISOString(),
    }));

    setToolDraftName("");
    setToolDraftDescription("");
    setToolDraftSchema("{\n  \"type\": \"object\",\n  \"properties\": {}\n}");
  }

  async function handleSendPrompt() {
    if (!selectedConversation || !composerValue.trim() || streaming || pendingToolCall) {
      return;
    }

    const prompt = composerValue.trim();
    setComposerValue("");

    const userStep = createStep("user", "User", prompt);
    const nextConversation = {
      ...selectedConversation,
      title: selectedConversation.titleEdited
        ? selectedConversation.title
        : inferTitle([...selectedConversation.steps, userStep]),
      steps: [...selectedConversation.steps, userStep],
      updatedAt: new Date().toISOString(),
    };

    updateConversation(selectedConversation.id, () => nextConversation);

    await streamConversationResponse(nextConversation);
  }

  async function handleSendToolResult() {
    if (!selectedConversation || !pendingToolCall || !composerValue.trim() || streaming) {
      return;
    }

    const result = composerValue.trim();
    const toolResultStep = createStep(
      "tool_result",
      "Tool Result",
      result,
      undefined,
      {
        name: pendingToolCall.toolCall?.name ?? "tool",
      }
    );

    setComposerValue("");

    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      steps: [...conversation.steps, toolResultStep],
      updatedAt: new Date().toISOString(),
    }));

    const nextConversation = {
      ...selectedConversation,
      steps: [...selectedConversation.steps, toolResultStep],
    };

    // Reuse streamConversationResponse so tool results go through the backend
    await streamConversationResponse(nextConversation);
  }

  function handleStop() {
    stopStreamRef.current?.();
  }

  async function handleCopyRequestJson() {
    try {
      await copyTextToClipboard(requestJsonPreview);
      setRequestJsonCopyState("copied");
    } catch {
      setRequestJsonCopyState("error");
    }
  }

  const selectedModel = selectedConversation
    ? modelSelectKey(selectedConversation.provider, selectedConversation.model)
    : modelSelectKey(availableModels[0]?.provider, availableModels[0]?.name ?? "");
  const selectedTemperature = selectedConversation?.temperature;
  const temperatureSupported = selectedConversation
    ? supportsTemperature(
        availableModels.find(
          (m) =>
            m.name === selectedConversation.model &&
            m.provider === selectedConversation.provider
        )
      )
    : false;

  const composerMode = pendingToolCall ? "tool_result" : "prompt";
  const composerLabel = composerMode === "tool_result" ? "Tool result" : "Prompt";
  const composerPlaceholder =
    composerMode === "tool_result"
      ? `Paste the result for ${pendingToolCall?.toolCall?.name ?? "the requested tool"} to continue.`
      : "Ask the local model to explain, reason, or emit tool calls.";
  const toolDraftSchemaError = useMemo(() => {
    const value = toolDraftSchema.trim();
    if (!value) {
      return "";
    }

    try {
      JSON.parse(value);
      return "";
    } catch {
      return "Input schema must be valid JSON.";
    }
  }, [toolDraftSchema]);
  const canEditSystemPrompt =
    selectedConversation != null &&
    selectedConversation.steps.every((step) => step.kind === "system");

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
        color: "text.primary",
      }}
    >
      <AppBar
        position="sticky"
        color="transparent"
        elevation={0}
        sx={{
          backdropFilter: "blur(18px)",
          borderBottom: "1px solid",
          borderColor: "divider",
          backgroundColor: "var(--surface-appbar)",
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <HubOutlinedIcon />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6">Ollamable</Typography>
            <Typography variant="body2" color="text.secondary">
              Step-level local chat visualization for Ollama sessions
            </Typography>
          </Box>
          {selectedConversation ? (
            <FormControl sx={{ minWidth: 220 }}>
              <InputLabel id="header-model-select-label">Model</InputLabel>
              <Select
                labelId="header-model-select-label"
                value={selectedModel}
                label="Model"
                onChange={(event) => handleModelChange(event.target.value)}
                disabled={loadingModels}
                size="small"
              >
                {groupModelsByProvider(availableModels)}
              </Select>
            </FormControl>
          ) : null}
          {selectedConversation ? (
            <FormControl sx={{ minWidth: 100 }} disabled={!temperatureSupported}>
              <InputLabel id="header-temperature-select-label">Temp</InputLabel>
              <Select
                labelId="header-temperature-select-label"
                value={selectedTemperature ?? ""}
                label="Temp"
                onChange={(event) => {
                  const val = event.target.value as string | number;
                  handleTemperatureChange(val === "" ? undefined : Number(val));
                }}
                disabled={!temperatureSupported}
                size="small"
              >
                <MenuItem value="">
                  <em>Default</em>
                </MenuItem>
                {TEMPERATURE_OPTIONS.map((temp) => (
                  <MenuItem key={temp} value={temp}>
                    {temp.toFixed(1)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          <Tooltip title={wsConnected ? "Backend connected" : "Backend disconnected (using direct Ollama)"}>
            <Box sx={{ display: "flex", alignItems: "center", mr: 1 }}>
              {wsConnected ? (
                <CloudIcon fontSize="small" sx={{ color: "success.main" }} />
              ) : (
                <CloudOffIcon fontSize="small" sx={{ color: "text.disabled" }} />
              )}
            </Box>
          </Tooltip>
          <ColorModeToggle />
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: `calc(100dvh - ${APP_BAR_HEIGHT}px)`, overflow: "hidden" }}>
        <Paper
          square
          sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            position: "sticky",
            top: APP_BAR_HEIGHT,
            alignSelf: "flex-start",
            height: `calc(100dvh - ${APP_BAR_HEIGHT}px)`,
            borderRight: "1px solid",
            borderColor: "divider",
            p: 2,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            backgroundColor: "var(--surface-sidebar)",
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="overline" color="primary.light">
              Conversations
            </Typography>
            <Tooltip title="New conversation">
              <IconButton
                aria-label="New conversation"
                color="primary"
                onClick={handleCreateConversation}
              >
                <AddIcon />
              </IconButton>
            </Tooltip>
          </Stack>

          <List sx={{ p: 0, overflowY: "auto", flexGrow: 1 }}>
            {conversations.map((conversation) => (
              <ListItemButton
                key={conversation.id}
                selected={conversation.id === selectedConversationId}
                onClick={() => setSelectedConversationId(conversation.id)}
                sx={{
                  mb: 1,
                  borderRadius: 3,
                  alignItems: "flex-start",
                  gap: 1,
                }}
              >
                <ListItemText
                  primary={conversation.title}
                  secondary={`${conversation.model} • ${formatTimestamp(conversation.updatedAt)}`}
                  primaryTypographyProps={{ fontWeight: 600 }}
                  secondaryTypographyProps={{ sx: { mt: 0.5 } }}
                />
                <Tooltip title="Delete conversation">
                  <IconButton
                    aria-label={`Delete conversation ${conversation.title}`}
                    edge="end"
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteConversation(conversation.id);
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
            ))}
          </List>
        </Paper>

        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            minHeight: 0,
            px: { xs: 2, md: 4 },
            py: 3,
            maxWidth: `calc(100vw - ${SIDEBAR_WIDTH}px)`,
          }}
        >
          {selectedConversation ? (
            <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column", gap: 3 }}>
              <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", pr: 1 }}>
                <Stack spacing={3} sx={{ pb: 1 }}>
                  {error ? <Alert severity="warning">{error}</Alert> : null}

                  <Paper
                    sx={{
                      p: 3,
                      border: "1px solid",
                      borderColor: "divider",
                      backgroundColor: "var(--surface-card)",
                    }}
                  >
                    <Stack spacing={2}>
                      <Stack
                        direction={{ xs: "column", md: "row" }}
                        spacing={2}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", md: "center" }}
                      >
                        <Box sx={{ flex: 1 }}>
                          {editingConversationId === selectedConversation.id ? (
                            <TextField
                              label="Conversation name"
                              value={titleDraft}
                              onChange={(event) => setTitleDraft(event.target.value)}
                              onBlur={() => handleSaveTitle(selectedConversation.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleSaveTitle(selectedConversation.id);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  handleCancelTitleEdit();
                                }
                              }}
                              autoFocus
                              fullWidth
                              size="small"
                            />
                          ) : (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography
                                variant="h5"
                                onClick={() => handleStartTitleEdit(selectedConversation)}
                                sx={{ cursor: "text" }}
                              >
                                {selectedConversation.title}
                              </Typography>
                              <Tooltip title="Edit conversation title">
                                <IconButton
                                  aria-label="Edit conversation title"
                                  size="small"
                                  onClick={() => handleStartTitleEdit(selectedConversation)}
                                >
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          )}
                          <Typography color="text.secondary" sx={{ mt: 1 }}>
                            Set the system prompt before sending the first message, then inspect the authentic conversation transcript below.
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Chip
                            label="json"
                            variant="outlined"
                            clickable
                            onClick={() => setRequestJsonOpen(true)}
                            aria-label="Open request JSON preview"
                          />
                          <Chip
                            icon={<MemoryIcon />}
                            label={selectedConversation.model}
                            color="primary"
                            clickable
                            onClick={() => void handleOpenModelMeta()}
                            aria-label={`Open metadata for ${selectedConversation.model}`}
                          />
                          <Badge
                            badgeContent={activeTools.length}
                            color="secondary"
                            overlap="rectangular"
                            showZero
                          >
                            <Chip
                              label="Tools"
                              variant="outlined"
                              clickable
                              onClick={() => setToolsModalOpen(true)}
                              aria-label={`Open tools modal with ${activeTools.length} active tools`}
                            />
                          </Badge>
                        </Stack>
                      </Stack>
                      <TextField
                        label="System prompt"
                        multiline
                        minRows={4}
                        value={selectedConversation.systemPrompt}
                        onChange={(event) => handlePromptChange(event.target.value)}
                        disabled={!canEditSystemPrompt}
                        placeholder="No system prompt set."
                        helperText={
                          canEditSystemPrompt
                            ? "Editable until the first message is sent."
                            : "Locked after the conversation starts."
                        }
                      />
                    </Stack>
                  </Paper>

                  <Stack spacing={2}>
                    {visibleTranscriptSteps.map((step) => (
                        <Paper
                          key={step.id}
                          data-step-kind={step.kind}
                          sx={{
                            overflow: "hidden",
                            border: "1px solid",
                            borderColor: "divider",
                            backgroundColor: getStepBackgroundColor(step.kind, theme),
                          }}
                        >
                          <ListItemButton onClick={() => handleToggleStep(step.id)}>
                            {step.kind === "meta" ? (
                              <Box sx={{ mr: 1.5, display: "flex", color: "#00bcd4" }}>
                                {getMetaEventIcon(step.metaEvent?.kind)}
                              </Box>
                            ) : null}
                            <ListItemText
                              primary={step.title}
                              secondary={formatStepSecondary(step)}
                              primaryTypographyProps={{ fontWeight: 700, textTransform: "capitalize" }}
                            />
                            <Chip
                              size="small"
                              label={step.kind === "meta" ? step.metaEvent?.kind?.replace(/_/g, " ") ?? "meta" : step.kind}
                              color={step.kind === "assistant" ? "primary" : step.kind === "meta" ? "info" : "default"}
                              variant="outlined"
                              sx={{ mr: 1 }}
                            />
                            {step.kind === "user" ? (
                              <Tooltip title="Edit message">
                                <span>
                                  <IconButton
                                    aria-label={`Edit message ${step.content}`}
                                    size="small"
                                    sx={{ mr: 1 }}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleStartStepEdit(step);
                                    }}
                                    disabled={streaming}
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            ) : null}
                            {step.kind === "assistant" ? (
                              <Tooltip title="Regenerate response">
                                <span>
                                  <IconButton
                                    aria-label={`Regenerate response ${step.content}`}
                                    size="small"
                                    sx={{ mr: 1 }}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleRegenerateAssistantStep(step.id);
                                    }}
                                    disabled={streaming}
                                  >
                                    <ReplayIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            ) : null}
                            {step.expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                          </ListItemButton>
                          <Collapse in={Boolean(step.expanded)}>
                            <Divider />
                            <Box sx={{ p: 2.5 }}>
                              {step.toolCall ? (
                                <Paper
                                  variant="outlined"
                                  sx={{
                                    p: 2,
                                    mb: 2,
                                    backgroundColor: "var(--surface-inset)",
                                  }}
                                >
                                  <Typography variant="overline" color="secondary.main">
                                    Tool Payload
                                  </Typography>
                                  <Typography variant="body2" sx={{ mt: 1, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                                    {JSON.stringify(step.toolCall, null, 2)}
                                  </Typography>
                                </Paper>
                              ) : null}
                              {step.toolResult ? (
                                <Paper
                                  variant="outlined"
                                  sx={{
                                    p: 2,
                                    mb: 2,
                                    backgroundColor: "var(--surface-inset)",
                                  }}
                                >
                                  <Typography variant="overline" color="secondary.main">
                                    Tool Name
                                  </Typography>
                                  <Typography variant="body2" sx={{ mt: 1, fontFamily: "monospace" }}>
                                    {step.toolResult.name}
                                  </Typography>
                                </Paper>
                              ) : null}
                              {step.metaEvent?.data ? (
                                <Paper
                                  variant="outlined"
                                  sx={{
                                    p: 2,
                                    mb: 2,
                                    backgroundColor: "var(--surface-inset)",
                                    borderColor: alpha("#00bcd4", 0.3),
                                  }}
                                >
                                  <Typography variant="overline" sx={{ color: "#00bcd4" }}>
                                    Server Event Data
                                  </Typography>
                                  <Typography variant="body2" sx={{ mt: 1, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                                    {JSON.stringify(step.metaEvent.data, null, 2)}
                                  </Typography>
                                </Paper>
                              ) : null}
                              {editingStepId === step.id ? (
                                <Stack spacing={1.5}>
                                  <TextField
                                    label="Edit message"
                                    multiline
                                    minRows={3}
                                    value={stepDraft}
                                    onChange={(event) => setStepDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault();
                                        void handleSaveStepEdit(step.id);
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        handleCancelStepEdit();
                                      }
                                    }}
                                    autoFocus
                                    helperText="Press Enter to send and discard the rest of the conversation. Shift+Enter inserts a newline."
                                  />
                                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                                    <Button variant="text" color="inherit" onClick={handleCancelStepEdit}>
                                      Abort
                                    </Button>
                                    <Button variant="contained" onClick={() => void handleSaveStepEdit(step.id)}>
                                      Send
                                    </Button>
                                  </Stack>
                                </Stack>
                              ) : (
                                <Typography
                                  variant="body1"
                                  sx={{
                                    whiteSpace: "pre-wrap",
                                    lineHeight: 1.7,
                                    color: "text.primary",
                                  }}
                                >
                                  {step.content}
                                </Typography>
                              )}
                            </Box>
                          </Collapse>
                        </Paper>
                      ))}
                    <Box ref={transcriptEndRef} aria-hidden="true" />
                  </Stack>
                </Stack>
              </Box>

              <Paper
                data-composer-mode={composerMode}
                sx={{
                  p: 3,
                  flexShrink: 0,
                  border: "1px solid",
                  borderColor: "divider",
                  background:
                    composerMode === "tool_result"
                      ? "var(--surface-composer-tool)"
                      : "var(--surface-composer)",
                }}
              >
                <Stack spacing={2}>
                  {pendingToolCall?.toolCall ? (
                    <Alert severity="info">
                      {`Provide the result for ${pendingToolCall.toolCall.name} before sending another prompt.`}
                    </Alert>
                  ) : null}
                  <TextField
                    label={composerLabel}
                    multiline
                    minRows={3}
                    maxRows={12}
                    value={composerValue}
                    onChange={(event) => setComposerValue(event.target.value)}
                    placeholder={composerPlaceholder}
                    inputProps={{
                      style: {
                        overflowY: "auto",
                      },
                    }}
                  />
                  <Stack direction="row" spacing={1} justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      {composerMode === "tool_result"
                        ? "Tool output is sent back to Ollama as the required tool result."
                        : "Responses stream directly from Ollama and are stored in local storage."}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {streaming ? (
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          aria-live="polite"
                        >
                          <CircularProgress size={18} aria-label="Waiting for response" />
                          <Typography variant="body2" color="text.secondary">
                            Waiting for response
                          </Typography>
                        </Stack>
                      ) : null}
                      {streaming ? (
                        <Button
                          variant="outlined"
                          color="secondary"
                          startIcon={<StopIcon />}
                          onClick={handleStop}
                        >
                          Stop
                        </Button>
                      ) : null}
                      <Button
                        variant="contained"
                        startIcon={
                          streaming ? (
                            <CircularProgress size={18} color="inherit" />
                          ) : (
                            <PlayArrowIcon />
                          )
                        }
                        onClick={() =>
                          void (composerMode === "tool_result"
                            ? handleSendToolResult()
                            : handleSendPrompt())
                        }
                        disabled={!composerValue.trim() || streaming}
                      >
                        {composerMode === "tool_result" ? "Submit result" : "Send"}
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            </Box>
          ) : null}
        </Box>
      </Box>

      <Dialog
        open={toolsModalOpen}
        onClose={() => setToolsModalOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Conversation tools</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography color="text.secondary">
              Active tools are sent to Ollama with each assistant turn. Custom tools are stored on the current conversation.
            </Typography>

            <Stack spacing={1.5}>
              {selectedConversation?.availableTools.map((tool) => (
                <Paper key={tool.id} variant="outlined" sx={{ p: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={selectedConversation.activeToolIds.includes(tool.id)}
                        onChange={() => handleToggleConversationTool(tool.id)}
                      />
                    }
                    label={
                      <Box>
                        <Typography fontWeight={700}>{tool.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {tool.description}
                        </Typography>
                      </Box>
                    }
                    sx={{ alignItems: "flex-start", m: 0 }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 1.5,
                      whiteSpace: "pre-wrap",
                      fontFamily: "monospace",
                      color: "primary.light",
                    }}
                  >
                    {tool.inputSchema}
                  </Typography>
                </Paper>
              ))}
            </Stack>

            <Divider />

            <Stack spacing={1.5}>
              <Typography variant="h6">Add tool</Typography>
              <TextField
                label="Tool name"
                value={toolDraftName}
                onChange={(event) => setToolDraftName(event.target.value)}
                placeholder="example_tool"
              />
              <TextField
                label="Description"
                value={toolDraftDescription}
                onChange={(event) => setToolDraftDescription(event.target.value)}
                placeholder="What the tool does"
              />
              <TextField
                label="Input schema"
                value={toolDraftSchema}
                onChange={(event) => setToolDraftSchema(event.target.value)}
                multiline
                minRows={6}
                error={Boolean(toolDraftSchemaError)}
                helperText={toolDraftSchemaError || "Enter a JSON object describing the tool input."}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleAddTool}
            disabled={
              !toolDraftName.trim() ||
              !toolDraftDescription.trim() ||
              !toolDraftSchema.trim() ||
              Boolean(toolDraftSchemaError)
            }
          >
            Add tool
          </Button>
          <Button onClick={() => setToolsModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={modelMetaOpen}
        onClose={() => setModelMetaOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{selectedConversation?.model ?? "Model metadata"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {modelMetaLoading ? (
              <Stack direction="row" spacing={1.5} alignItems="center">
                <CircularProgress size={18} aria-label="Loading model metadata" />
                <Typography color="text.secondary">
                  Loading metadata from Ollama
                </Typography>
              </Stack>
            ) : null}

            {modelMetaError ? <Alert severity="warning">{modelMetaError}</Alert> : null}

            {modelMeta ? (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {renderMetaChip("Family", modelMeta.family)}
                  {renderMetaChip("Parameters", modelMeta.parameterSize)}
                  {renderMetaChip("Format", modelMeta.format)}
                  {renderMetaChip("Quantization", modelMeta.quantizationLevel)}
                  {renderMetaChip("Parent", modelMeta.parentModel)}
                </Stack>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="overline" color="primary.light">
                    Summary
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                    {formatKeyValueSummary(modelMeta)}
                  </Typography>
                </Paper>

                {modelMeta.capabilities?.length ? (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="overline" color="primary.light">
                      Capabilities
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      {modelMeta.capabilities.map((capability) => (
                        <Chip key={capability} size="small" label={capability} variant="outlined" />
                      ))}
                    </Stack>
                  </Paper>
                ) : null}

                {renderJsonSection("Details", modelMeta.details)}
                {renderJsonSection("Model Info", modelMeta.modelInfo)}
                {renderTextSection("Parameters", modelMeta.parameters)}
                {renderTextSection("System", modelMeta.system)}
                {renderTextSection("Template", modelMeta.template)}
                {renderTextSection("License", modelMeta.license)}
              </>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModelMetaOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={requestJsonOpen}
        onClose={() => setRequestJsonOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Request JSON</DialogTitle>
        <DialogContent dividers>
          {requestJsonCopyState === "copied" ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              JSON copied to clipboard.
            </Alert>
          ) : null}
          {requestJsonCopyState === "error" ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Failed to copy JSON to clipboard.
            </Alert>
          ) : null}
          <Typography
            component="pre"
            variant="body2"
            sx={{
              m: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "monospace",
            }}
          >
            {requestJsonPreview}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void handleCopyRequestJson()}>Copy</Button>
          <Button onClick={() => setRequestJsonOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function isVisibleTranscriptStep(step: ConversationStep) {
  return (
    step.kind === "user" ||
    step.kind === "assistant" ||
    step.kind === "reasoning" ||
    step.kind === "meta"
  );
}

function formatStepSecondary(step: ConversationStep): string {
  if (step.kind === "meta" && step.metaEvent?.durationMs != null) {
    return `${step.metaEvent.kind.replace(/_/g, " ")} • ${step.metaEvent.durationMs}ms`;
  }

  const base = `${step.kind.replace("_", " ")} • ${formatTimestamp(step.createdAt)}`;

  if (step.usage) {
    const parts: string[] = [];
    if (step.usage.inputTokens != null) parts.push(`in: ${step.usage.inputTokens}`);
    if (step.usage.outputTokens != null) parts.push(`out: ${step.usage.outputTokens}`);
    if (step.usage.stopReason) parts.push(`stop: ${step.usage.stopReason}`);
    if (parts.length > 0) return `${base} • ${parts.join(" / ")}`;
  }

  return base;
}

function getStepBackgroundColor(
  kind: ConversationStep["kind"],
  theme: Theme
) {
  if (theme.palette.mode === "dark") {
    switch (kind) {
      case "system":
        return alpha(theme.palette.info.dark, 0.28);
      case "user":
        return alpha(theme.palette.primary.dark, 0.24);
      case "assistant":
        return alpha(theme.palette.success.dark, 0.24);
      case "reasoning":
        return alpha(theme.palette.warning.dark, 0.2);
      case "tool_call":
        return alpha(theme.palette.secondary.dark, 0.18);
      case "tool_result":
        return alpha(theme.palette.error.dark, 0.22);
      case "meta":
        return alpha("#00bcd4", 0.15);
      default:
        return alpha(theme.palette.background.paper, 0.9);
    }
  }

  switch (kind) {
    case "system":
      return alpha(theme.palette.info.light, 0.22);
    case "user":
      return alpha(theme.palette.primary.light, 0.18);
    case "assistant":
      return alpha(theme.palette.success.light, 0.2);
    case "reasoning":
      return alpha(theme.palette.warning.light, 0.22);
    case "tool_call":
      return alpha(theme.palette.secondary.light, 0.15);
    case "tool_result":
      return alpha(theme.palette.error.light, 0.18);
    case "meta":
      return alpha("#00bcd4", 0.12);
    default:
      return alpha(theme.palette.background.paper, 0.92);
  }
}

function getPendingToolCallStep(conversation: Conversation) {
  const resolvedToolCallIds = new Set<string>();
  for (const step of conversation.steps) {
    if (step.kind === "tool_result" && step.toolResult) {
      resolvedToolCallIds.add(step.toolResult.name + ":" + step.id);
    }
  }

  // Walk backward to find the most recent unresolved tool_call
  for (let index = conversation.steps.length - 1; index >= 0; index -= 1) {
    const step = conversation.steps[index];
    if (step.kind === "user") {
      // Stop at the last user message — tool_calls before it belong to a prior turn
      return null;
    }
    if (step.kind === "tool_call" && step.toolCall) {
      // Check if this tool_call has a matching tool_result after it
      const hasResult = conversation.steps
        .slice(index + 1)
        .some((s) => s.kind === "tool_result" && s.toolResult?.name === step.toolCall!.name);
      if (!hasResult) {
        return step;
      }
    }
  }

  return null;
}

function findResponseStartIndex(steps: ConversationStep[], assistantIndex: number) {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const step = steps[index];

    if (step.kind === "user" || step.kind === "system" || step.kind === "tool_result") {
      return index + 1;
    }
  }

  return 0;
}

/**
 * Build a composite key for the model Select so that models with the same
 * name on different providers remain distinguishable.
 */
function modelSelectKey(provider: string | undefined, name: string): string {
  return provider ? `${provider}:${name}` : name;
}

function parseModelSelectKey(key: string): { provider?: string; model: string } {
  const idx = key.indexOf(":");
  if (idx === -1) return { model: key };
  return { provider: key.slice(0, idx), model: key.slice(idx + 1) };
}

function groupModelsByProvider(models: OllamaModel[]) {
  const providers = new Map<string, OllamaModel[]>();
  for (const model of models) {
    const key = model.providerName ?? "Local";
    const group = providers.get(key) ?? [];
    group.push(model);
    providers.set(key, group);
  }

  // If there's only one provider, skip the subheaders
  if (providers.size <= 1) {
    return models.map((model) => {
      const value = modelSelectKey(model.provider, model.name);
      return (
        <MenuItem key={value} value={value}>
          {model.name}
        </MenuItem>
      );
    });
  }

  const elements: React.ReactNode[] = [];
  for (const [providerName, group] of providers) {
    elements.push(
      <ListSubheader key={`header-${providerName}`}>{providerName}</ListSubheader>
    );
    for (const model of group) {
      const value = modelSelectKey(model.provider, model.name);
      elements.push(
        <MenuItem key={value} value={value}>
          {model.name}
        </MenuItem>
      );
    }
  }

  return elements;
}

function isEmbeddingModel(model: OllamaModel) {
  const families = [...(model.families ?? []), model.family, model.parentModel]
    .filter(Boolean)
    .map((value) => value!.toLowerCase());

  const embeddingFamilies = [
    "bert",
    "bge",
    "gte",
    "embeddinggemma",
    "nomic-bert",
    "snowflake-arctic-embed",
    "all-minilm",
    "mxbai-embed-large",
  ];

  if (families.some((family) => embeddingFamilies.some((token) => family.includes(token)))) {
    return true;
  }

  return /^\d+\s*d$/i.test(model.parameterSize?.trim() ?? "");
}

function supportsTemperature(model: OllamaModel | undefined): boolean {
  if (!model) {
    return false;
  }

  return !isEmbeddingModel(model);
}

function renderMetaChip(label: string, value?: string) {
  if (!value) {
    return null;
  }

  return <Chip size="small" variant="outlined" label={`${label}: ${value}`} />;
}

function renderTextSection(label: string, value?: string) {
  if (!value?.trim()) {
    return null;
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" color="primary.light">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ mt: 1, whiteSpace: "pre-wrap", fontFamily: "monospace" }}
      >
        {value}
      </Typography>
    </Paper>
  );
}

function renderJsonSection(
  label: string,
  value?: Record<string, string | number | boolean | string[] | undefined>
) {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" color="primary.light">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ mt: 1, whiteSpace: "pre-wrap", fontFamily: "monospace" }}
      >
        {JSON.stringify(value, null, 2)}
      </Typography>
    </Paper>
  );
}

function formatKeyValueSummary(modelMeta: OllamaModelMeta) {
  const entries = [
    ["Name", modelMeta.name],
    ["Modified", modelMeta.modifiedAt],
    ["Family", modelMeta.family],
    ["Families", modelMeta.families?.join(", ")],
    ["Parameter size", modelMeta.parameterSize],
    ["Format", modelMeta.format],
    ["Quantization", modelMeta.quantizationLevel],
    ["Parent", modelMeta.parentModel],
  ].filter(([, value]) => Boolean(value));

  return entries.map(([key, value]) => `${key}: ${value}`).join("\n");
}

function getMetaEventIcon(kind?: string) {
  switch (kind) {
    case "mcp_connect":
    case "mcp_call":
    case "mcp_result":
      return <SyncIcon fontSize="small" />;
    case "search_start":
    case "search_result":
      return <SearchIcon fontSize="small" />;
    case "context_start":
    case "context_done":
      return <MemoryIcon fontSize="small" />;
    default:
      return <CloudIcon fontSize="small" />;
  }
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Copy command failed.");
  }
}
