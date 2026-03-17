import { AudioDots } from "@/components/AudioDots";
import { useSetting } from "@/contexts/SettingsContext";
import { useRecording } from "@/hooks/useRecording";
import { PillIndicatorMode } from "@/types";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type PillState =
  | "idle"
  | "listening"
  | "transcribing"
  | "formatting"
  | "timeout_warning"
  | "timeout_exceeded"
  | "task_running"
  | "task_success";

export function RecordingPill() {
  const recording = useRecording();
  const [audioLevel, setAudioLevel] = useState(0);
  const [isFormatting, setIsFormatting] = useState(false);
  const [taskState, setTaskState] = useState<"idle" | "running" | "success">("idle");
  const [timeoutWarningSeconds, setTimeoutWarningSeconds] = useState<number | null>(null);
  const [timeoutExceeded, setTimeoutExceeded] = useState(false);

  // Setting: pill indicator mode (default: "when_recording")
  const pillIndicatorMode: PillIndicatorMode = useSetting("pill_indicator_mode") ?? "when_recording";

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
  const isListening = pillState === "listening";
  const isActive = pillState !== "idle";

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
          if (isMounted) setTaskState("running");
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

  // Determine if pill should be hidden based on mode and state
  // "never" → always hide
  // "always" → never hide (always show)
  // "when_recording" → hide when idle
  const shouldHide =
    pillIndicatorMode === "never" ||
    (pillIndicatorMode === "when_recording" && pillState === "idle");

  if (shouldHide) {
    return null;
  }

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
