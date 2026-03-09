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
  | "task_running"
  | "task_success";

export function RecordingPill() {
  const recording = useRecording();
  const [audioLevel, setAudioLevel] = useState(0);
  const [isFormatting, setIsFormatting] = useState(false);
  const [taskState, setTaskState] = useState<"idle" | "running" | "success">("idle");

  // Setting: pill indicator mode (default: "when_recording")
  const pillIndicatorMode: PillIndicatorMode = useSetting("pill_indicator_mode") ?? "when_recording";

  // Determine pill state
  const getPillState = (): PillState => {
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
      : pillState === "formatting"
      ? "Enhancing"
      : pillState === "transcribing"
      ? "Transcribing"
      : pillState === "listening"
      ? "Listening"
      : "";

  return (
    <div className="fixed inset-0 flex items-center justify-center">
      {/* Solid black pill - grows when active */}
      <motion.div
        className="flex items-center gap-3 justify-center rounded-full select-none bg-black shadow-lg ring-1 ring-white/30"
        animate={{
          // ~1.4x growth from idle to active
          paddingLeft: isActive ? 14 : 10,
          paddingRight: isActive ? 14 : 10,
          paddingTop: isActive ? 7 : 5,
          paddingBottom: isActive ? 7 : 5,
        }}
        transition={{
          duration: 0.25,
          ease: "easeOut",
        }}
      >
        <AudioDots state={pillState} audioLevel={audioLevel} />
        {label ? <span className="text-xs font-medium text-white">{label}</span> : null}
      </motion.div>
    </div>
  );
}
