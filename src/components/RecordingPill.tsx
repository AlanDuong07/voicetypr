import { AudioDots } from "@/components/AudioDots";
import { useSetting } from "@/contexts/SettingsContext";
import { useRecording } from "@/hooks/useRecording";
import { PillIndicatorMode } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion } from "framer-motion";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type PillState =
  | "idle"
  | "listening"
  | "transcribing"
  | "formatting"
  | "timeout_warning"
  | "timeout_exceeded"
  | "task_running"
  | "task_success";

const BASE_PILL_HEIGHT = 72;
const COMPOSER_MIN_TEXTAREA_HEIGHT = 24;
const COMPOSER_MAX_TEXTAREA_HEIGHT = 120;
const COMPOSER_BASE_WINDOW_HEIGHT = 112;
const COMPOSER_MAX_WINDOW_HEIGHT = 220;

export function RecordingPill() {
  const recording = useRecording();
  const [audioLevel, setAudioLevel] = useState(0);
  const [isFormatting, setIsFormatting] = useState(false);
  const [taskState, setTaskState] = useState<"idle" | "running" | "success">("idle");
  const [timeoutWarningSeconds, setTimeoutWarningSeconds] = useState<number | null>(null);
  const [timeoutExceeded, setTimeoutExceeded] = useState(false);
  const [computerUseDraft, setComputerUseDraft] = useState("");
  const [computerUseTextEntryActive, setComputerUseTextEntryActive] = useState(false);
  const [isSubmittingComputerUseTask, setIsSubmittingComputerUseTask] = useState(false);
  const [focusRequestCount, setFocusRequestCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPillHeight = useRef<number>(BASE_PILL_HEIGHT);

  // Setting: pill indicator mode (default: "when_recording")
  const pillIndicatorMode: PillIndicatorMode = useSetting("pill_indicator_mode") ?? "when_recording";
  const computerUseHotkey = useSetting("computer_use_hotkey") ?? "Option+Space";
  const computerUseTypingModeEnabled =
    useSetting("computer_use_typing_mode_enabled") ?? true;
  const isComputerUseSession = recording.voiceOutputMode === "computer_use";

  const showComputerUseComposer =
    computerUseTypingModeEnabled &&
    taskState === "idle" &&
    !timeoutExceeded &&
    timeoutWarningSeconds === null &&
    (computerUseTextEntryActive ||
      (isComputerUseSession &&
        (recording.state === "starting" || recording.state === "recording")));

  // Determine pill state
  const getPillState = (): PillState => {
    if (timeoutExceeded) return "timeout_exceeded";
    if (timeoutWarningSeconds !== null) return "timeout_warning";
    if (taskState === "success") return "task_success";
    if (taskState === "running") return "task_running";
    if (isFormatting) return "formatting";
    if (recording.state === "recording") return "listening";
    if (recording.state === "transcribing" || recording.state === "stopping")
      return "transcribing";
    return "idle";
  };

  const pillState = getPillState();
  const isListening = pillState === "listening" && !showComputerUseComposer;
  const isActive = pillState !== "idle";

  const syncComposerHeight = useCallback(() => {
    const textarea = textareaRef.current;

    if (!showComputerUseComposer || !textarea) {
      if (lastPillHeight.current !== BASE_PILL_HEIGHT) {
        lastPillHeight.current = BASE_PILL_HEIGHT;
        void invoke("resize_pill_widget", { height: BASE_PILL_HEIGHT }).catch(() => {});
      }
      return;
    }

    textarea.style.height = "0px";
    const measuredHeight = Math.min(
      Math.max(textarea.scrollHeight, COMPOSER_MIN_TEXTAREA_HEIGHT),
      COMPOSER_MAX_TEXTAREA_HEIGHT,
    );
    textarea.style.height = `${measuredHeight}px`;

    const nextHeight = Math.min(
      COMPOSER_BASE_WINDOW_HEIGHT +
        Math.max(0, measuredHeight - COMPOSER_MIN_TEXTAREA_HEIGHT),
      COMPOSER_MAX_WINDOW_HEIGHT,
    );

    if (lastPillHeight.current !== nextHeight) {
      lastPillHeight.current = nextHeight;
      void invoke("resize_pill_widget", { height: nextHeight }).catch(() => {});
    }
  }, [showComputerUseComposer]);

  // Listen for audio level events
  useEffect(() => {
    if (isListening) {
      let isMounted = true;
      let unlistenFn: (() => void) | undefined;

      listen<number>("audio-level", (event) => {
        if (isMounted) setAudioLevel(event.payload);
      }).then((unlisten) => {
        if (!isMounted) {
          unlisten();
          return;
        }
        unlistenFn = unlisten;
      });

      return () => {
        isMounted = false;
        if (unlistenFn) unlistenFn();
        setAudioLevel(0);
      };
    } else {
      const timeoutId = setTimeout(() => setAudioLevel(0), 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isListening]);

  useLayoutEffect(() => {
    syncComposerHeight();
  }, [computerUseDraft, showComputerUseComposer, syncComposerHeight]);

  useEffect(() => {
    if (!showComputerUseComposer) {
      return;
    }

    const focusTextarea = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      const cursorPosition = textarea.value.length;
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    };

    const frame = window.requestAnimationFrame(focusTextarea);
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequestCount, showComputerUseComposer]);

  useEffect(() => {
    if (recording.state !== "recording") {
      setTimeoutWarningSeconds(null);
    }

    if (recording.state === "starting" || recording.state === "idle") {
      setTimeoutWarningSeconds(null);
      setTimeoutExceeded(false);
    }
  }, [recording.state]);

  // Listen for formatting/enhancement events (global events from backend)
  useEffect(() => {
    let isMounted = true;
    const unlistenFns: (() => void)[] = [];

    const events = [
      { name: "enhancing-started", handler: () => {
        if (isMounted) setIsFormatting(true);
      }},
      { name: "enhancing-completed", handler: () => {
        if (isMounted) setIsFormatting(false);
      }},
      { name: "enhancing-failed", handler: () => {
        if (isMounted) setIsFormatting(false);
      }},
      {
        name: "inactivity-timeout-warning",
        handler: (event: { payload: { seconds_remaining?: number } }) => {
          if (!isMounted) return;
          const secondsRemaining = event.payload?.seconds_remaining;
          if (typeof secondsRemaining === "number") {
            setTimeoutExceeded(false);
            setTimeoutWarningSeconds(secondsRemaining);
          }
        }
      },
      {
        name: "inactivity-timeout-cleared",
        handler: () => {
          if (!isMounted) return;
          setTimeoutWarningSeconds(null);
          setTimeoutExceeded(false);
        }
      },
      {
        name: "inactivity-timeout-exceeded",
        handler: () => {
          if (!isMounted) return;
          setTimeoutWarningSeconds(null);
          setTimeoutExceeded(true);
        }
      },
      {
        name: "computer-task-started",
        handler: () => {
          if (isMounted) {
            setTaskState("running");
            setComputerUseTextEntryActive(false);
            setComputerUseDraft("");
          }
        }
      },
      {
        name: "computer-task-completed",
        handler: () => {
          if (isMounted) setTaskState("success");
        }
      },
      {
        name: "computer-task-cleared",
        handler: () => {
          if (isMounted) setTaskState("idle");
        }
      },
      {
        name: "computer-task-failed",
        handler: () => {
          if (isMounted) setTaskState("idle");
        }
      },
      {
        name: "computer-use-text-entry-activated",
        handler: () => {
          if (!isMounted) return;
          setComputerUseTextEntryActive(true);
          setFocusRequestCount((count) => count + 1);
        }
      },
      {
        name: "computer-use-text-entry-cleared",
        handler: () => {
          if (!isMounted) return;
          setComputerUseTextEntryActive(false);
          setComputerUseDraft("");
        }
      },
      {
        name: "computer-use-text-entry-focus",
        handler: () => {
          if (!isMounted) return;
          setFocusRequestCount((count) => count + 1);
        }
      },
    ];

    events.forEach(({ name, handler }) => {
      listen(name, handler).then((unlisten) => {
        if (!isMounted) {
          unlisten();
          return;
        }
        unlistenFns.push(unlisten);
      });
    });

    return () => {
      isMounted = false;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

  // The backend now fully owns when the pill window is shown or hidden.
  // Keep frontend rendering permissive so a state-sync race cannot make the
  // pill window appear completely blank while the window itself is visible.
  if (pillIndicatorMode === "never") {
    return null;
  }

  const submitComputerUseTask = useCallback(async () => {
    const trimmedTask = computerUseDraft.trim();
    if (!trimmedTask || isSubmittingComputerUseTask) {
      return;
    }

    try {
      setIsSubmittingComputerUseTask(true);
      await invoke("submit_computer_use_text_task", { task: trimmedTask });
      setComputerUseTextEntryActive(false);
      setComputerUseDraft("");
    } catch (error) {
      console.error("Failed to submit typed computer-use task:", error);
      setFocusRequestCount((count) => count + 1);
    } finally {
      setIsSubmittingComputerUseTask(false);
    }
  }, [computerUseDraft, isSubmittingComputerUseTask]);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | undefined;

    listen("computer-use-submit-requested", () => {
      if (!isMounted) return;
      void submitComputerUseTask();
    }).then((dispose) => {
      if (!isMounted) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      isMounted = false;
      if (unlisten) unlisten();
    };
  }, [submitComputerUseTask]);

  const handleComputerUseDraftChange = async (
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const nextValue = event.target.value;
    setComputerUseDraft(nextValue);

    if (
      computerUseTypingModeEnabled &&
      !computerUseTextEntryActive &&
      nextValue.length > 0
    ) {
      setComputerUseTextEntryActive(true);
      try {
        await invoke("begin_computer_use_text_entry");
      } catch (error) {
        console.error("Failed to begin computer-use text entry:", error);
      }
    }
  };

  const handleComputerUseKeyDown = async (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await submitComputerUseTask();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      try {
        await invoke("cancel_computer_use_text_entry");
      } catch (error) {
        console.error("Failed to cancel computer-use text entry:", error);
      }
    }
  };

  const label =
    pillState === "task_running"
      ? "Running task"
      : pillState === "task_success"
      ? "Task complete"
      : pillState === "timeout_exceeded"
      ? "Timeout exceeded"
      : pillState === "timeout_warning"
      ? `Inactivity timeout in ${timeoutWarningSeconds}`
      : pillState === "formatting"
      ? "Enhancing"
      : pillState === "transcribing"
      ? "Transcribing"
      : pillState === "listening"
      ? "Listening"
      : "";

  if (showComputerUseComposer) {
    const placeholder =
      recording.state === "recording"
        ? "Speak or start typing a task..."
        : "Type a task...";

    return (
      <motion.div
        className="relative flex w-[340px] max-w-[340px] flex-col rounded-[22px] border border-white/18 bg-[rgba(15,23,42,0.78)] px-4 py-3 text-white shadow-[0_18px_50px_rgba(2,6,23,0.38),0_6px_18px_rgba(2,6,23,0.24)] backdrop-blur-md before:pointer-events-none before:absolute before:inset-0 before:rounded-[22px] before:content-[''] before:shadow-[inset_2px_2px_0_-1px_rgba(255,255,255,0.55),inset_0_1px_0_rgba(255,255,255,0.18)]"
        animate={{ opacity: 1, y: 0 }}
        initial={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <textarea
          ref={textareaRef}
          value={computerUseDraft}
          onChange={(event) => {
            void handleComputerUseDraftChange(event);
          }}
          onKeyDown={(event) => {
            void handleComputerUseKeyDown(event);
          }}
          placeholder={placeholder}
          rows={1}
          className="min-h-6 w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-6 font-medium text-white outline-none placeholder:text-white/50"
        />
        <div className="mt-2 text-[11px] leading-4 text-white/60">
          Press <span className="font-medium text-white/72">Enter</span> or{" "}
          <span className="font-medium text-white/72">{computerUseHotkey}</span> to
          send. Shift+Enter adds a new line. Esc cancels.
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="relative flex max-w-full items-center justify-center gap-3 whitespace-nowrap rounded-full border border-white/18 bg-[rgba(15,23,42,0.74)] text-white select-none shadow-[0_18px_50px_rgba(2,6,23,0.38),0_6px_18px_rgba(2,6,23,0.24)] before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:content-[''] before:shadow-[inset_2px_2px_0_-1px_rgba(255,255,255,0.55),inset_0_1px_0_rgba(255,255,255,0.18)]"
      animate={{
        // ~1.4x growth from idle to active
        paddingLeft: isActive ? 16 : 12,
        paddingRight: isActive ? 16 : 12,
        paddingTop: isActive ? 8 : 6,
        paddingBottom: isActive ? 8 : 6,
      }}
      transition={{
        duration: 0.25,
        ease: "easeOut",
      }}
    >
      <AudioDots state={pillState} audioLevel={audioLevel} />
      {label ? (
        <span className="max-w-[220px] truncate text-[13px] leading-none font-medium text-white">
          {label}
        </span>
      ) : null}
    </motion.div>
  );
}
