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
  InputAdornment,
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
  Typography,
} from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CloudIcon from "@mui/icons-material/Cloud";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import MemoryIcon from "@mui/icons-material/Memory";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import SearchIcon from "@mui/icons-material/Search";
import StopIcon from "@mui/icons-material/Stop";
import SyncIcon from "@mui/icons-material/Sync";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import type { Conversation, ConversationStep, OllamaModel, OllamaModelMeta, ToolDefinition } from "@/src/types/chat";
import { ColorModeToggle } from "@/src/components/color-mode-toggle";
import {
  createConversation,
  createStep,
  ensureConversationTools,
  fallbackModels,
  formatTimestamp,
  inferTitle,
  loadConversations,
  loadSelectedConversationId,
  loadSidebarState,
  saveConversations,
  saveSelectedConversationId,
  saveSidebarState,
} from "@/src/lib/chat";
import type { SidebarState } from "@/src/lib/chat";
import {
  fetchAllModels,
  fetchModelMeta,
  fetchTools,
} from "@/src/lib/ollama";
import { useWebSocket } from "@/src/lib/use-websocket";
import { BackendClient, WS_URL } from "@/src/lib/backend-client";

const SIDEBAR_WIDTH = 320;
const APP_BAR_HEIGHT = 65;
const SIDEBAR_COLLAPSED_WIDTH = 44;
const RIGHT_SIDEBAR_WIDTH = 360;
const TEMPERATURE_OPTIONS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 2.0];

export function ChatWorkspace() {
  const theme = useTheme();
  const [models, setModels] = useState<OllamaModel[]>(fallbackModels);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [composerValue, setComposerValue] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [toolFilterActive, setToolFilterActive] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelFilterReasoning, setModelFilterReasoning] = useState(false);
  const [sidebarState, setSidebarState] = useState<SidebarState>({
    sidebarOpen: true,
    rightSidebarOpen: false,
    modelSectionOpen: false,
    tempSectionOpen: false,
    maxTokensSectionOpen: false,
    toolsSectionOpen: false,
    subsections: {},
  });

  // Load persisted sidebar state on mount
  useEffect(() => {
    setSidebarState(loadSidebarState());
  }, []);

  const updateSidebar = useCallback((patch: Partial<SidebarState>) => {
    setSidebarState((prev) => {
      const next = { ...prev, ...patch };
      saveSidebarState(next);
      return next;
    });
  }, []);

  const {
    sidebarOpen,
    rightSidebarOpen,
    modelSectionOpen,
    tempSectionOpen,
    maxTokensSectionOpen,
    toolsSectionOpen,
    subsections,
  } = sidebarState;

  const isSubsectionOpen = useCallback(
    (key: string) => subsections[key] ?? false,
    [subsections]
  );

  const toggleSubsection = useCallback(
    (key: string) => {
      setSidebarState((prev) => {
        const opening = !(prev.subsections[key] ?? false);
        const cleared = opening
          ? Object.fromEntries(Object.keys(prev.subsections).map((k) => [k, false]))
          : prev.subsections;
        const next = {
          ...prev,
          subsections: { ...cleared, [key]: opening },
        };
        saveSidebarState(next);
        return next;
      });
    },
    []
  );

  const toggleRightSection = useCallback(
    (key: "modelSectionOpen" | "tempSectionOpen" | "maxTokensSectionOpen" | "toolsSectionOpen") => {
      setSidebarState((prev) => {
        const opening = !prev[key];
        const next = {
          ...prev,
          modelSectionOpen: false,
          tempSectionOpen: false,
          maxTokensSectionOpen: false,
          toolsSectionOpen: false,
          [key]: opening,
        };
        saveSidebarState(next);
        return next;
      });
    },
    []
  );

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
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
      const msg = data as { type?: string; tools?: ToolDefinition[] };
      if (msg.type === "tools.update" && msg.tools) {
        setTools((current) => {
          const merged = [...current];
          for (const tool of msg.tools!) {
            if (!merged.some((t) => t.id === tool.id)) {
              merged.push(tool);
            }
          }
          return merged;
        });
        return;
      }
      backendClientRef.current.handleServerMessage(data);
    },
    []
  );

  const { send: wsSend, connected: wsConnected } = useWebSocket(WS_URL, handleWsMessage);

  useEffect(() => {
    const initialConversations = loadConversations([]);
    const selectedId = loadSelectedConversationId() ?? initialConversations[0]?.id ?? "";

    setConversations(initialConversations);
    setSelectedConversationId(selectedId);
  }, []);

  // Fetch available tools from the backend
  useEffect(() => {
    let cancelled = false;
    async function loadTools() {
      try {
        const remoteTools = await fetchTools();
        if (!cancelled) {
          setTools(remoteTools);
        }
      } catch {
        // Backend unreachable — no tools available
      }
    }
    void loadTools();
    return () => { cancelled = true; };
  }, []);

  // Re-sync existing conversations when the tool list changes
  useEffect(() => {
    if (tools.length === 0) return;
    setConversations((current) =>
      current.map((conv) => ensureConversationTools(conv, tools))
    );
  }, [tools]);

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
        const models = await fetchAllModels();
        if (!cancelled && models.length > 0) {
          setModels(models);
        }
      } catch {
        if (!cancelled) {
          setError("Could not reach the backend. Using fallback model list.");
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
  const toolSearchLower = toolSearch.toLowerCase();
  const hasToolFilter = toolFilterActive || Boolean(toolSearchLower);
  const activeToolIds = selectedConversation?.activeToolIds ?? [];
  const matchesToolFilter = useCallback(
    (t: ToolDefinition) => {
      if (toolSearchLower && !t.name.toLowerCase().includes(toolSearchLower)) return false;
      if (toolFilterActive && !activeToolIds.includes(t.id)) return false;
      return true;
    },
    [toolSearchLower, toolFilterActive, activeToolIds]
  );
  const builtinTools = useMemo(
    () => (selectedConversation?.availableTools ?? [])
      .filter((t) => !t.id.startsWith("mcp-"))
      .filter(matchesToolFilter),
    [selectedConversation, matchesToolFilter]
  );
  const mcpServers = useMemo(() => {
    const servers = new Map<string, ToolDefinition[]>();
    for (const tool of selectedConversation?.availableTools ?? []) {
      const match = tool.id.match(/^mcp-(.+?)-/);
      if (!match) continue;
      if (!matchesToolFilter(tool)) continue;
      const serverName = match[1];
      const group = servers.get(serverName) ?? [];
      group.push(tool);
      servers.set(serverName, group);
    }
    return servers;
  }, [selectedConversation, toolSearchLower]);
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

    return JSON.stringify(
      {
        type: "chat.send",
        conversationId: selectedConversation.id,
        model: selectedConversation.model,
        provider: selectedConversation.provider,
        steps: selectedConversation.steps,
        tools: activeTools,
        temperature: selectedConversation.temperature,
        maxOutputTokens: selectedConversation.maxOutputTokens,
      },
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
    const conversation = createConversation(model, tools, firstModel?.provider);
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

  function handleMaxOutputTokensChange(value: number | undefined) {
    if (!selectedConversation) {
      return;
    }

    updateConversation(selectedConversation.id, (conversation) => ({
      ...conversation,
      maxOutputTokens: value,
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

    setModelMetaOpen(true);
    setModelMetaLoading(true);
    setModelMetaError("");
    setModelMeta(null);

    try {
      const nextMeta = await fetchModelMeta(model);
      setModelMeta(nextMeta);
    } catch (err) {
      setModelMetaError(
        err instanceof Error ? err.message : "Failed to load model metadata."
      );
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
      maxOutputTokens: nextConversation.maxOutputTokens,
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

  async function handleResendUserStep(stepId: string) {
    if (!selectedConversation || streaming) {
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

    const nextConversation = {
      ...selectedConversation,
      steps: selectedConversation.steps.slice(0, stepIndex + 1),
      updatedAt: new Date().toISOString(),
    };

    updateConversation(selectedConversation.id, () => nextConversation);
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
  const composerLabel = composerMode === "tool_result" ? "Tool result" : "User Prompt";
  const composerPlaceholder =
    composerMode === "tool_result"
      ? `Paste the result for ${pendingToolCall?.toolCall?.name ?? "the requested tool"} to continue.`
      : "Ask the local model to explain, reason, or emit tool calls.";
  const canEditSystemPrompt = selectedConversation != null;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
        overscrollBehavior: "none",
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
        <Toolbar sx={{ gap: 2, px: { xs: 2, sm: 2 }, minHeight: APP_BAR_HEIGHT }}>
          <HubOutlinedIcon />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6">Ollamable</Typography>
            <Typography variant="body2" color="text.secondary">
              Step-level local chat visualization of LLM sessions
            </Typography>
          </Box>
          {selectedConversation ? (
            <Chip
              icon={<MemoryIcon />}
              label={selectedConversation.model}
              color="primary"
              clickable
              onClick={() => void handleOpenModelMeta()}
              aria-label={`Open metadata for ${selectedConversation.model}`}
              size="small"
            />
          ) : null}
          {activeTools.length > 0 ? (
            <Chip
              label={`${activeTools.length} ${activeTools.length === 1 ? "Tool" : "Tools"}`}
              size="small"
              color="secondary"
              onClick={() => updateSidebar({ rightSidebarOpen: true })}
            />
          ) : null}
          <ColorModeToggle />
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: `calc(100dvh - ${APP_BAR_HEIGHT}px)`, overflow: "hidden" }}>
        <Paper
          square
          onClick={sidebarOpen ? undefined : () => updateSidebar({ sidebarOpen: true })}
          sx={{
            width: sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
            minWidth: sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
            flexShrink: 0,
            position: "sticky",
            top: APP_BAR_HEIGHT,
            alignSelf: "flex-start",
            height: `calc(100dvh - ${APP_BAR_HEIGHT}px)`,
            borderRight: "1px solid",
            borderColor: "divider",
            backgroundColor: "var(--surface-sidebar)",
            overflow: "hidden",
            transition: "width 0.35s ease, min-width 0.35s ease",
            cursor: sidebarOpen ? "default" : "pointer",
          }}
        >
          <Box
            sx={{
              width: SIDEBAR_WIDTH,
              minWidth: SIDEBAR_WIDTH,
              height: "100%",
              py: 2,
              px: 1,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              marginLeft: sidebarOpen ? 0 : `${-(SIDEBAR_WIDTH - SIDEBAR_COLLAPSED_WIDTH)}px`,
              transition: "margin-left 0.35s ease",
            }}
          >
            <Stack direction="row" alignItems="center">
              <Typography
                variant="overline"
                color="primary.light"
                sx={{
                  flexGrow: 1,
                  opacity: sidebarOpen ? 1 : 0,
                  transition: "opacity 0.25s ease",
                }}
              >
                Conversations
              </Typography>
              <IconButton
                size="small"
                onClick={() => updateSidebar({ sidebarOpen: !sidebarOpen })}
                aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                sx={{ color: "text.secondary" }}
              >
                <ViewSidebarOutlinedIcon />
              </IconButton>
            </Stack>
            <Stack direction="row" alignItems="center">
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{
                  flexGrow: 1,
                  opacity: sidebarOpen ? 1 : 0,
                  transition: "opacity 0.25s ease",
                }}
              >
                New Chat
              </Typography>
              <IconButton
                size="small"
                onClick={handleCreateConversation}
                aria-label="New chat"
                sx={{ color: "text.secondary" }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Box sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              flexGrow: 1,
              minHeight: 0,
              opacity: sidebarOpen ? 1 : 0,
              transition: "opacity 0.25s ease",
              pointerEvents: sidebarOpen ? "auto" : "none",
            }}>
              <List sx={{ p: 0, overflowY: "auto", flexGrow: 1, scrollbarGutter: "stable", pr: 1 }}>
            {conversations.filter((c) => c.steps.some((s) => s.kind === "user")).map((conversation) => (
              <Paper
                key={conversation.id}
                variant="outlined"
                sx={{
                  mb: 0.5,
                  p: 1.5,
                  cursor: "pointer",
                  position: "relative",
                  "&:hover .conversation-actions": { opacity: 1 },
                  ...(conversation.id === selectedConversationId
                    ? {
                        borderColor: "primary.main",
                        bgcolor: "action.selected",
                      }
                    : {}),
                }}
                onClick={() => setSelectedConversationId(conversation.id)}
                onDoubleClick={() => handleStartTitleEdit(conversation)}
              >
                <IconButton
                  className="conversation-actions"
                  size="small"
                  onClick={(e) => { e.stopPropagation(); setRequestJsonOpen(true); }}
                  aria-label="Copy request JSON"
                  sx={{ position: "absolute", top: 4, right: 4, opacity: 0, transition: "opacity 0.15s ease" }}
                >
                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  className="conversation-actions"
                  size="small"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(conversation.id); }}
                  aria-label={`Delete conversation ${conversation.title}`}
                  sx={{ position: "absolute", bottom: 4, right: 4, opacity: 0, transition: "opacity 0.15s ease" }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                </IconButton>
                {editingConversationId === conversation.id ? (
                  <TextField
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => handleSaveTitle(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSaveTitle(conversation.id);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        handleCancelTitleEdit();
                      }
                    }}
                    onClick={(event) => event.stopPropagation()}
                    autoFocus
                    fullWidth
                    size="small"
                    variant="standard"
                    inputProps={{ style: { fontWeight: 600 } }}
                  />
                ) : (
                  <ListItemText
                    primary={conversation.title}
                    secondary={(() => {
                      const msgs = conversation.steps.filter((s) => s.kind === "user" || s.kind === "assistant").length;
                      const tools = conversation.steps.filter((s) => s.kind === "tool_call").length;
                      const input = conversation.steps.reduce((sum, s) => sum + (s.usage?.inputTokens ?? 0), 0);
                      const output = conversation.steps.reduce((sum, s) => sum + (s.usage?.outputTokens ?? 0), 0);
                      const tokens = input + output;
                      return <>{msgs} messages • {tools} tool uses<br />{tokens > 0 ? <>{tokens.toLocaleString()} tokens<br /></> : null}{formatTimestamp(conversation.updatedAt)}</>;
                    })()}
                    primaryTypographyProps={{ fontWeight: 600 }}
                    secondaryTypographyProps={{ sx: { mt: 0.5 } }}
                  />
                )}
              </Paper>
            ))}
          </List>
            </Box>
          </Box>
        </Paper>

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexGrow: 1,
            minWidth: 0,
            minHeight: 0,
            py: 1,
            gap: 1,
            maxWidth: `calc(100vw - ${sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH}px - ${rightSidebarOpen ? RIGHT_SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH}px)`,
            transition: "max-width 0.35s ease",
          }}
        >
          {selectedConversation ? (
            <>
              <Box sx={{
                flexGrow: 1,
                minHeight: 0,
                width: "100%",
                maxWidth: (sidebarOpen && rightSidebarOpen ? 900 : 700) + 48,
                transition: "max-width 0.35s ease",
                overflowY: "auto",
                px: 2,
                scrollbarGutter: "stable",
                maskImage: "linear-gradient(to bottom, transparent, black 6px, black calc(100% - 6px), transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent, black 6px, black calc(100% - 6px), transparent)",
              }}>
                <Stack spacing={2} sx={{ pt: 1, pb: 1, maxWidth: sidebarOpen && rightSidebarOpen ? 900 : 700, mx: "auto", transition: "max-width 0.35s ease" }}>
                  {error ? <Alert severity="warning">{error}</Alert> : null}

                  <TextField
                    label="System prompt"
                    InputLabelProps={{ shrink: true }}
                    multiline
                    minRows={4}
                    value={selectedConversation.systemPrompt}
                    onChange={(event) => handlePromptChange(event.target.value)}
                    disabled={!canEditSystemPrompt}
                    placeholder="No system prompt set."
                    sx={{ width: "100%" }}
                  />

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
                              primary={formatStepSecondary(step)}
                              primaryTypographyProps={{ variant: "body2", color: "text.secondary" }}
                            />
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
                              {(step.kind === "user" || step.kind === "assistant") ? (
                                <Stack direction="row" spacing={0.5} justifyContent="flex-end" sx={{ mt: 1 }}>
                                  {step.kind === "user" ? (
                                    <>
                                      <IconButton
                                        aria-label={`Edit message ${step.content}`}
                                        size="small"
                                        onClick={() => handleStartStepEdit(step)}
                                        disabled={streaming}
                                      >
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                      <IconButton
                                        aria-label={`Resend message ${step.content}`}
                                        size="small"
                                        onClick={() => void handleResendUserStep(step.id)}
                                        disabled={streaming}
                                      >
                                        <ReplayIcon fontSize="small" />
                                      </IconButton>
                                    </>
                                  ) : null}
                                  {step.kind === "assistant" ? (
                                    <IconButton
                                      aria-label={`Regenerate response ${step.content}`}
                                      size="small"
                                      onClick={() => void handleRegenerateAssistantStep(step.id)}
                                      disabled={streaming}
                                    >
                                      <ReplayIcon fontSize="small" />
                                    </IconButton>
                                  ) : null}
                                </Stack>
                              ) : null}
                            </Box>
                          </Collapse>
                        </Paper>
                      ))}
                    <Box ref={transcriptEndRef} aria-hidden="true" />
                  </Stack>
                </Stack>
              </Box>

              <Box
                data-composer-mode={composerMode}
                sx={{
                  flexShrink: 0,
                  width: "100%",
                  maxWidth: (sidebarOpen && rightSidebarOpen ? 900 : 700) + 48,
                  transition: "max-width 0.35s ease",
                  px: 2,
                  scrollbarGutter: "stable",
                }}
              >
                <Box sx={{
                  maxWidth: sidebarOpen && rightSidebarOpen ? 900 : 700,
                  mx: "auto",
                  transition: "max-width 0.35s ease",
                }}>

                {pendingToolCall?.toolCall ? (
                  <Alert severity="info" sx={{ mb: 1 }}>
                    {`Provide the result for ${pendingToolCall.toolCall.name} before sending another prompt.`}
                  </Alert>
                ) : null}
                <TextField
                  label={composerLabel}
                  InputLabelProps={{ shrink: true }}
                  multiline
                  minRows={3}
                  maxRows={12}
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (composerValue.trim() && !streaming) {
                        void (composerMode === "tool_result"
                          ? handleSendToolResult()
                          : handleSendPrompt());
                      }
                    }
                  }}
                  placeholder={composerPlaceholder}
                  inputProps={{
                    style: {
                      overflowY: "auto",
                    },
                  }}
                  fullWidth
                />
                {streaming ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    <CircularProgress size={18} />
                    <IconButton
                      color="secondary"
                      onClick={handleStop}
                      aria-label="Stop"
                      size="small"
                    >
                      <StopIcon />
                    </IconButton>
                  </Stack>
                ) : null}
                </Box>
              </Box>
            </>
          ) : null}
        </Box>

        <Paper
          square
          onClick={rightSidebarOpen ? undefined : () => updateSidebar({ rightSidebarOpen: true })}
          sx={{
            width: rightSidebarOpen ? RIGHT_SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
            minWidth: rightSidebarOpen ? RIGHT_SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
            flexShrink: 0,
            position: "sticky",
            top: APP_BAR_HEIGHT,
            alignSelf: "flex-start",
            height: `calc(100dvh - ${APP_BAR_HEIGHT}px)`,
            borderLeft: "1px solid",
            borderColor: "divider",
            backgroundColor: "var(--surface-sidebar)",
            overflow: "hidden",
            transition: "width 0.35s ease, min-width 0.35s ease",
            cursor: rightSidebarOpen ? "default" : "pointer",
          }}
        >
          <Box
            sx={{
              width: RIGHT_SIDEBAR_WIDTH,
              minWidth: RIGHT_SIDEBAR_WIDTH,
              height: "100%",
              py: 2,
              px: 1,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Stack direction="row" alignItems="center">
              <IconButton
                size="small"
                onClick={() => updateSidebar({ rightSidebarOpen: !rightSidebarOpen })}
                aria-label={rightSidebarOpen ? "Collapse tools sidebar" : "Expand tools sidebar"}
                sx={{ color: "text.secondary", transform: "scaleX(-1)" }}
              >
                <ViewSidebarOutlinedIcon />
              </IconButton>
              <Typography
                variant="overline"
                color="primary.light"
                sx={{
                  flexGrow: 1,
                  textAlign: "right",
                  opacity: rightSidebarOpen ? 1 : 0,
                  transition: rightSidebarOpen ? "opacity 0.2s ease 0.15s" : "opacity 0.1s ease",
                }}
              >
                Settings
              </Typography>
            </Stack>

            {selectedConversation ? (
              <Box sx={{
                overflowY: "auto",
                overflowX: "hidden",
                flexGrow: 1,
                scrollbarGutter: "stable",
                pr: 1.5,
                opacity: rightSidebarOpen ? 1 : 0,
                transition: rightSidebarOpen ? "opacity 0.2s ease 0.15s" : "opacity 0.1s ease",
                pointerEvents: rightSidebarOpen ? "auto" : "none",
              }}>
                <Stack spacing={0.5}>
                  <Box>
                    <ListItemButton
                      onClick={() => toggleRightSection("modelSectionOpen")}
                      sx={{ mx: -2, px: 2, py: 0.5 }}
                    >
                      <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
                        Models
                      </Typography>
                      {modelSectionOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </ListItemButton>
                    <Collapse in={modelSectionOpen}>
                      <SectionSearchField value={modelSearch} onChange={setModelSearch} placeholder="Search models…" />
                      <Stack direction="row" spacing={0.5} sx={{ mb: 0.5 }}>
                        <Chip
                          label="show reasoning only"
                          size="small"
                          variant={modelFilterReasoning ? "filled" : "outlined"}
                          color={modelFilterReasoning ? "primary" : "default"}
                          clickable
                          onClick={() => setModelFilterReasoning((prev) => !prev)}
                        />
                      </Stack>
                      <List dense sx={{ p: 0, mt: 0.5 }}>
                        {(() => {
                          const modelSearchLower = modelSearch.toLowerCase();
                          const filtered = availableModels.filter((m) => {
                            if (modelSearchLower && !m.name.toLowerCase().includes(modelSearchLower)) return false;
                            if (modelFilterReasoning && !isReasoningModel(m)) return false;
                            return true;
                          });
                          const providers = new Map<string, OllamaModel[]>();
                          for (const model of filtered) {
                            const key = model.providerName ?? "Local";
                            const group = providers.get(key) ?? [];
                            group.push(model);
                            providers.set(key, group);
                          }
                          const items: React.ReactNode[] = [];
                          for (const [providerName, group] of providers) {
                            const subsectionKey = `model-${providerName}`;
                            const hasModelFilter = modelFilterReasoning || Boolean(modelSearchLower);
                            const open = hasModelFilter || isSubsectionOpen(subsectionKey);
                            if (providers.size > 1) {
                              const hasSelectedModel = group.some(
                                (m) => modelSelectKey(m.provider, m.name) === selectedModel
                              );
                              items.push(
                                <ListItemButton
                                  key={`header-${providerName}`}
                                  onClick={() => toggleSubsection(subsectionKey)}
                                  selected={hasSelectedModel}
                                  sx={{ px: 1, py: 0.25, borderRadius: 1 }}
                                >
                                  <ListItemText
                                    primary={providerName}
                                    primaryTypographyProps={{ variant: "caption", color: hasSelectedModel ? "primary" : "text.secondary", fontWeight: 600 }}
                                  />
                                  <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                                    {group.length}
                                  </Typography>
                                  {open ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                                </ListItemButton>
                              );
                              items.push(
                                <Collapse key={`collapse-${providerName}`} in={open}>
                                  {group.map((model) => {
                                    const value = modelSelectKey(model.provider, model.name);
                                    const isSelected = value === selectedModel;
                                    return (
                                      <ListItemButton
                                        key={value}
                                        selected={isSelected}
                                        onClick={() => handleModelChange(value)}
                                        sx={{ borderRadius: 2, py: 0.25, px: 1, pl: 2 }}
                                      >
                                        <ListItemText
                                          primary={renderModelLabel(model)}
                                          primaryTypographyProps={{ variant: "body2" }}
                                        />
                                        {isSelected ? (
                                          <IconButton
                                            size="small"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleOpenModelMeta();
                                            }}
                                            aria-label="Model info"
                                          >
                                            <MemoryIcon fontSize="small" />
                                          </IconButton>
                                        ) : null}
                                      </ListItemButton>
                                    );
                                  })}
                                </Collapse>
                              );
                            } else {
                              for (const model of group) {
                                const value = modelSelectKey(model.provider, model.name);
                                const isSelected = value === selectedModel;
                                items.push(
                                  <ListItemButton
                                    key={value}
                                    selected={isSelected}
                                    onClick={() => handleModelChange(value)}
                                    sx={{ borderRadius: 2, py: 0.25, px: 1 }}
                                  >
                                    <ListItemText
                                      primary={renderModelLabel(model)}
                                      primaryTypographyProps={{ variant: "body2" }}
                                    />
                                    {isSelected ? (
                                      <IconButton
                                        size="small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleOpenModelMeta();
                                        }}
                                        aria-label="Model info"
                                      >
                                        <MemoryIcon fontSize="small" />
                                      </IconButton>
                                    ) : null}
                                  </ListItemButton>
                                );
                              }
                            }
                          }
                          return items;
                        })()}
                      </List>
                    </Collapse>
                  </Box>

                  <Divider />

                  <Box>
                    <ListItemButton
                      onClick={() => toggleRightSection("tempSectionOpen")}
                      sx={{ mx: -2, px: 2, py: 0.5 }}
                    >
                      <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
                        Temperature
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                        {selectedTemperature != null ? selectedTemperature.toFixed(1) : ""}
                      </Typography>
                      {tempSectionOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </ListItemButton>
                    <Collapse in={tempSectionOpen}>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        {[0.0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.0].map((val) => (
                          <Chip
                            key={val}
                            label={val.toFixed(1)}
                            size="small"
                            variant={selectedTemperature === val ? "filled" : "outlined"}
                            color={selectedTemperature === val ? "primary" : "default"}
                            clickable
                            onClick={() =>
                              handleTemperatureChange(selectedTemperature === val ? undefined : val)
                            }
                            disabled={!temperatureSupported}
                          />
                        ))}
                      </Stack>
                    </Collapse>
                  </Box>

                  <Divider />

                  <Box>
                    <ListItemButton
                      onClick={() => toggleRightSection("maxTokensSectionOpen")}
                      sx={{ mx: -2, px: 2, py: 0.5 }}
                    >
                      <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
                        Max Output Tokens
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                        {selectedConversation.maxOutputTokens ?? ""}
                      </Typography>
                      {maxTokensSectionOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </ListItemButton>
                    <Collapse in={maxTokensSectionOpen}>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        {[5, 10, 25, 50, 100, 250, 500, 1000].map((val) => (
                          <Chip
                            key={val}
                            label={val}
                            size="small"
                            variant={selectedConversation.maxOutputTokens === val ? "filled" : "outlined"}
                            color={selectedConversation.maxOutputTokens === val ? "primary" : "default"}
                            clickable
                            onClick={() =>
                              handleMaxOutputTokensChange(
                                selectedConversation.maxOutputTokens === val ? undefined : val
                              )
                            }
                          />
                        ))}
                      </Stack>
                    </Collapse>
                  </Box>

                  <Divider />

                  <Box>
                    <ListItemButton
                      onClick={() => toggleRightSection("toolsSectionOpen")}
                      sx={{ mx: -2, px: 2, py: 0.5 }}
                    >
                      <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
                        Tools
                      </Typography>
                      {toolsSectionOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </ListItemButton>
                    <Collapse in={toolsSectionOpen}>
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        <SectionSearchField value={toolSearch} onChange={setToolSearch} placeholder="Search tools…" />
                        <Stack direction="row" spacing={0.5} sx={{ mb: 0.5 }}>
                          <Chip
                            label="show active only"
                            size="small"
                            variant={toolFilterActive ? "filled" : "outlined"}
                            color={toolFilterActive ? "primary" : "default"}
                            clickable
                            onClick={() => setToolFilterActive((prev) => !prev)}
                          />
                          <Chip
                            label="disable all"
                            size="small"
                            variant="outlined"
                            clickable
                            disabled={!selectedConversation || selectedConversation.activeToolIds.length === 0}
                            onClick={() => {
                              if (selectedConversation) {
                                updateConversation(selectedConversation.id, (c) => ({
                                  ...c,
                                  activeToolIds: [],
                                  updatedAt: new Date().toISOString(),
                                }));
                              }
                            }}
                          />
                        </Stack>
                        {/* ── Built-in tools subsection ── */}
                        {/* Force-expand subsections when a filter or search is active */}
                        <Box>
                          <ListItemButton
                            onClick={() => toggleSubsection("tools-builtin")}
                            sx={{ mx: -1, px: 1, py: 0.25, borderRadius: 1 }}
                          >
                            <ListItemText
                              primary="built-in"
                              primaryTypographyProps={{ variant: "caption", color: "text.secondary", fontWeight: 600 }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                              {builtinTools.length}
                            </Typography>
                            {(hasToolFilter || isSubsectionOpen("tools-builtin")) ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                          </ListItemButton>
                          <Collapse in={hasToolFilter || isSubsectionOpen("tools-builtin")}>
                            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                              {builtinTools.map((tool) => (
                                <Paper key={tool.id} variant="outlined" sx={{ p: 1.5 }}>
                                  <FormControlLabel
                                    control={
                                      <Checkbox
                                        checked={selectedConversation.activeToolIds.includes(tool.id)}
                                        onChange={() => handleToggleConversationTool(tool.id)}
                                        size="small"
                                      />
                                    }
                                    label={
                                      <Box>
                                        <Typography variant="body2" fontWeight={700}>{tool.name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {tool.description}
                                        </Typography>
                                      </Box>
                                    }
                                    sx={{ alignItems: "flex-start", m: 0 }}
                                  />
                                  {renderToolSchema(tool)}
                                </Paper>
                              ))}

                            </Stack>
                          </Collapse>
                        </Box>

                        {/* ── MCP tools subsections (one per server) ── */}
                        {Array.from(mcpServers.entries()).map(([serverName, serverTools]) => {
                          const key = `tools-mcp-${serverName}`;
                          return (
                            <Box key={serverName}>
                              <ListItemButton
                                onClick={() => toggleSubsection(key)}
                                sx={{ mx: -1, px: 1, py: 0.25, borderRadius: 1 }}
                              >
                                <HubOutlinedIcon sx={{ fontSize: 14, mr: 0.5, color: "text.secondary" }} />
                                <ListItemText
                                  primary={serverName}
                                  primaryTypographyProps={{ variant: "caption", color: "text.secondary", fontWeight: 600 }}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                                  {serverTools.length}
                                </Typography>
                                {(hasToolFilter || isSubsectionOpen(key)) ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                              </ListItemButton>
                              <Collapse in={hasToolFilter || isSubsectionOpen(key)}>
                                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                                  {serverTools.map((tool) => (
                                    <Paper key={tool.id} variant="outlined" sx={{ p: 1.5 }}>
                                      <FormControlLabel
                                        control={
                                          <Checkbox
                                            checked={selectedConversation.activeToolIds.includes(tool.id)}
                                            onChange={() => handleToggleConversationTool(tool.id)}
                                            size="small"
                                          />
                                        }
                                        label={
                                          <Box>
                                            <Typography variant="body2" fontWeight={700}>{tool.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                              {tool.description}
                                            </Typography>
                                          </Box>
                                        }
                                        sx={{ alignItems: "flex-start", m: 0 }}
                                      />
                                      {renderToolSchema(tool)}
                                    </Paper>
                                  ))}
                                </Stack>
                              </Collapse>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Collapse>
                  </Box>
                </Stack>
              </Box>
            ) : null}
          </Box>
        </Paper>
      </Box>

      <Dialog open={deleteConfirmId != null} onClose={() => setDeleteConfirmId(null)}>
        <DialogTitle>Delete conversation?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will permanently remove the conversation and all its messages.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (deleteConfirmId) handleDeleteConversation(deleteConfirmId);
              setDeleteConfirmId(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!wsConnected}>
        <DialogTitle>Backend not connected</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Unable to connect to the backend server. All model requests are routed through the backend.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Make sure the server is running with <code>make dev</code> and try refreshing the page.
          </Typography>
        </DialogContent>
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

function SectionSearchField({ value, onChange, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <TextField
      size="small"
      placeholder={placeholder ?? "Search…"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 14 }} />
            </InputAdornment>
          ),
          sx: { py: 0.25, px: 1, fontSize: "0.8rem" },
        },
        htmlInput: { sx: { py: "4px" } },
      }}
      sx={{ mb: 0.5 }}
      fullWidth
    />
  );
}

function renderToolSchema(tool: ToolDefinition) {
  try {
    const schema = JSON.parse(tool.inputSchema) as {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    const props = schema.properties;
    if (!props || Object.keys(props).length === 0) return null;
    const required = schema.required ?? [];
    return (
      <Box sx={{ mt: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "2px 8px 2px 0", color: "gray" }}>Property</th>
              <th style={{ textAlign: "left", padding: "2px 8px", color: "gray" }}>Type</th>
              <th style={{ textAlign: "center", padding: "2px 4px", color: "gray" }}>Req</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(props).map(([name, def]) => (
              <tr key={name}>
                <td style={{ padding: "2px 8px 2px 0", fontFamily: "monospace" }}>{name}</td>
                <td style={{ padding: "2px 8px", fontFamily: "monospace", color: "gray" }}>{def.type ?? "—"}</td>
                <td style={{ textAlign: "center", padding: "2px 4px" }}>
                  <Checkbox checked={required.includes(name)} size="small" disabled sx={{ p: 0 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  } catch {
    return (
      <Typography variant="caption" sx={{ mt: 1, display: "block", whiteSpace: "pre-wrap", fontFamily: "monospace", color: "text.secondary" }}>
        {tool.inputSchema}
      </Typography>
    );
  }
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

function renderModelLabel(model: OllamaModel) {
  return (
    <span style={{ display: "flex", gap: "6px" }}>
      <span style={{ width: "1.2em", flexShrink: 0, textAlign: "center" }}>
        {isReasoningModel(model) ? "\u2728" : ""}
      </span>
      <span>{model.name}</span>
    </span>
  );
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
          {renderModelLabel(model)}
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
          {renderModelLabel(model)}
        </MenuItem>
      );
    }
  }

  return elements;
}

/** Known reasoning model name patterns. */
const REASONING_MODEL_PATTERNS = [
  // Ollama / open-source reasoning models
  /\bdeepseek-r1\b/i,
  /\bqwq\b/i,
  /\bqwen3\b/i,
  /\bmarco-o1\b/i,
  /\bskywork-o1\b/i,
  /\bexaone-deep\b/i,
  /\bphi-4-reasoning\b/i,
  // OpenAI reasoning models
  /\bo1\b/i,
  /\bo3\b/i,
  /\bo4[-\s]?mini\b/i,
  // MiniMax reasoning models
  /\bMiniMax-M1\b/i,
  /\bMiniMax-M2\.5\b/i,
  /\bMiniMax-M2\.7\b/i,
];

function isReasoningModel(model: OllamaModel): boolean {
  if (model.capabilities?.includes("thinking")) return true;
  return REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(model.name));
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
