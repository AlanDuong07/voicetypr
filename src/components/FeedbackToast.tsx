import { listen } from "@tauri-apps/api/event";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";

interface PillToastPayload {
  id: number;
  message: string;
  duration_ms: number;
}

export function FeedbackToast() {
  const [message, setMessage] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMessage = useCallback((text: string, duration: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    setMessage(text);

    timerRef.current = setTimeout(() => {
      setMessage("");
      timerRef.current = null;
    }, duration);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | undefined;

    listen<PillToastPayload>("toast", (evt) => {
      if (!isMounted) return;
      const { message, duration_ms } = evt.payload;
      showMessage(message, duration_ms);
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
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [showMessage]);

  if (!message) {
    return null;
  }

  const content = formatToastContent(message);

  return (
    <div className="fixed inset-0 flex items-end justify-center px-4 pb-4">
      <div className="flex w-full max-w-[420px] items-start gap-3 rounded-2xl border border-white/10 bg-black/92 px-4 py-3 shadow-2xl backdrop-blur-xl">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${content.iconBgClass}`}>
          {content.icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-white">
            {content.title}
          </p>
          {content.body ? (
            <p className="mt-1 text-sm leading-5 text-white/72">
              {content.body}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatToastContent(message: string) {
  const raw = message.trim();
  const lower = raw.toLowerCase();

  if (
    lower.includes("invalid audio data provided") ||
    lower.includes("at least 1 second of 16khz audio") ||
    lower.includes("recording too short") ||
    lower.includes("too short")
  ) {
    return {
      title: "Recording too short",
      body: "Speak for a bit longer and try again.",
      icon: <TriangleAlert className="h-4 w-4 text-amber-700" />,
      iconBgClass: "bg-amber-100",
    };
  }

  if (lower.includes("no speech detected")) {
    return {
      title: "No speech detected",
      body: "Try speaking closer to the microphone.",
      icon: <Info className="h-4 w-4 text-sky-700" />,
      iconBgClass: "bg-sky-100",
    };
  }

  if (lower.includes("text copied - grant permission to auto-paste")) {
    return {
      title: "Auto-paste unavailable",
      body: "The transcript was copied to your clipboard.",
      icon: <Info className="h-4 w-4 text-sky-700" />,
      iconBgClass: "bg-sky-100",
    };
  }

  if (lower.includes("paste failed - text in clipboard")) {
    return {
      title: "Paste failed",
      body: "The transcript is still in your clipboard.",
      icon: <TriangleAlert className="h-4 w-4 text-amber-700" />,
      iconBgClass: "bg-amber-100",
    };
  }

  if (lower.includes("task complete")) {
    return {
      title: "Task complete",
      body: "",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-700" />,
      iconBgClass: "bg-emerald-100",
    };
  }

  if (lower.includes("task submission failed")) {
    return {
      title: "Task submission failed",
      body: "Please try again in a moment.",
      icon: <AlertCircle className="h-4 w-4 text-rose-700" />,
      iconBgClass: "bg-rose-100",
    };
  }

  if (lower.includes("microphone access failed")) {
    return {
      title: "Microphone unavailable",
      body: "Check your microphone permission or selected input.",
      icon: <AlertCircle className="h-4 w-4 text-rose-700" />,
      iconBgClass: "bg-rose-100",
    };
  }

  if (lower.includes("formatting failed")) {
    return {
      title: "Formatting unavailable",
      body: "Your transcript is still available.",
      icon: <TriangleAlert className="h-4 w-4 text-amber-700" />,
      iconBgClass: "bg-amber-100",
    };
  }

  if (lower.includes("failed")) {
    return {
      title: "Something went wrong",
      body: raw,
      icon: <AlertCircle className="h-4 w-4 text-rose-700" />,
      iconBgClass: "bg-rose-100",
    };
  }

  return {
    title: raw,
    body: "",
    icon: <Info className="h-4 w-4 text-sky-700" />,
    iconBgClass: "bg-sky-100",
  };
}
