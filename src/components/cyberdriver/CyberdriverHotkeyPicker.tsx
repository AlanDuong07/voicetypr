import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { mapCodeToKey } from "@/lib/keyboard-mapper";
import {
  formatKeyForDisplay,
  normalizeShortcutKeys,
  validateKeyCombinationWithRules,
} from "@/lib/keyboard-normalizer";
import { checkForSystemConflict, formatConflictMessage } from "@/lib/hotkey-conflicts";
import { isMacOS } from "@/lib/platform";
import { Pencil, Sparkles, Type, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const TOKEN_DISPLAY_ORDER = [
  "LeftCommand",
  "RightCommand",
  "CommandOrControl",
  "Command",
  "Super",
  "Meta",
  "LeftControl",
  "RightControl",
  "Control",
  "Ctrl",
  "LeftAlt",
  "RightAlt",
  "LeftOption",
  "RightOption",
  "Alt",
  "Option",
  "LeftShift",
  "RightShift",
  "Shift",
  "Fn",
];

interface CyberdriverHotkeyPickerProps {
  icon: "dictation" | "computer-use";
  label: string;
  helperText?: string;
  dialogDescription: string;
  value: string;
  onChange: (value: string) => void;
  recommendedShortcuts: string[];
}

export function CyberdriverHotkeyPicker({
  icon,
  label,
  helperText,
  dialogDescription,
  value,
  onChange,
  recommendedShortcuts,
}: CyberdriverHotkeyPickerProps) {
  const [open, setOpen] = useState(false);
  const [showRecommended, setShowRecommended] = useState(false);
  const [candidateShortcut, setCandidateShortcut] = useState("");
  const [candidateDisplay, setCandidateDisplay] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "warning" | null>(null);
  const captureBoxRef = useRef<HTMLButtonElement | null>(null);
  const pressedTokensRef = useRef<Set<string>>(new Set());

  const displayedValue = useMemo(
    () => formatHotkeyLabel(value),
    [value]
  );

  const resetDialogState = useCallback(() => {
    setCandidateShortcut("");
    setCandidateDisplay("");
    setValidationMessage("");
    setMessageTone(null);
    setShowRecommended(false);
    pressedTokensRef.current = new Set();
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    resetDialogState();
  }, [resetDialogState]);

  const applyShortcutCandidate = useCallback((shortcut: string, displayOverride?: string) => {
    const normalized = normalizeShortcutKeys(shortcut);
    const validation = validateHotkeyCandidate(normalized);
    const display = displayOverride || formatHotkeyLabel(normalized);

    setCandidateDisplay(display);

    if (!validation.valid) {
      setCandidateShortcut("");
      setValidationMessage(validation.error || "Invalid key combination");
      setMessageTone("error");
      return;
    }

    const conflict = checkForSystemConflict(normalized);
    if (conflict) {
      setValidationMessage(formatConflictMessage(conflict));
      setMessageTone(conflict.severity === "warning" ? "warning" : "error");
      if (conflict.severity === "error") {
        setCandidateShortcut("");
        return;
      }
    } else {
      setValidationMessage("");
      setMessageTone(null);
    }

    setCandidateShortcut(normalized);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      captureBoxRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.repeat) {
        return;
      }

      if (
        event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        closeDialog();
        return;
      }

      const token = getTokenFromKeyboardEvent(event);
      if (!token) {
        return;
      }

      pressedTokensRef.current.add(token);
      const shortcut = buildShortcutFromPressedTokens(pressedTokensRef.current);
      applyShortcutCandidate(shortcut);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const token = getTokenFromKeyboardEvent(event);
      if (!token) {
        return;
      }

      pressedTokensRef.current.delete(token);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [applyShortcutCandidate, closeDialog, open]);

  const handleSave = useCallback(() => {
    if (!candidateShortcut) {
      return;
    }
    onChange(candidateShortcut);
    closeDialog();
  }, [candidateShortcut, closeDialog, onChange]);

  const rowIcon = icon === "dictation" ? <Type className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />;

  return (
    <>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
            {rowIcon}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">{label}</p>
            {helperText ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground">{helperText}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex min-h-9 items-center rounded-xl border border-border/80 bg-background px-3.5 py-1.5 text-[15px] font-medium text-foreground shadow-xs">
            {displayedValue}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl border border-transparent text-foreground hover:border-border hover:bg-muted"
            onClick={() => setOpen(true)}
            aria-label={`Edit ${label}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeDialog();
            return;
          }
          setOpen(true);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-[560px] px-6 py-6"
        >
          <button
            type="button"
            onClick={closeDialog}
            className="absolute top-5 right-5 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close hotkey dialog"
          >
            <X className="h-5 w-5" />
          </button>

          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="max-w-[360px] text-[2.1rem] leading-[1.05] font-semibold tracking-tight text-foreground">
              Press desired key combination
            </DialogTitle>
            <DialogDescription className="text-[0.98rem] text-muted-foreground">
              {dialogDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <button
              type="button"
              ref={captureBoxRef}
              className="flex min-h-[96px] w-full items-center justify-center rounded-lg border border-border bg-muted px-5 py-5 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              {candidateDisplay ? (
                <div className="inline-flex min-h-11 items-center rounded-xl border border-border/80 bg-background px-4 py-2 text-[1rem] font-medium text-foreground shadow-xs">
                  {candidateDisplay}
                </div>
              ) : (
                <span className="text-[15px] text-muted-foreground">
                  Press your shortcut now
                </span>
              )}
            </button>

            {validationMessage ? (
              <p
                className={cn(
                  "text-[13px]",
                  messageTone === "warning" ? "text-amber-600" : "text-destructive"
                )}
              >
                {validationMessage}
              </p>
            ) : null}

            <button
              type="button"
              className="text-left text-[15px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowRecommended((current) => !current)}
            >
              {showRecommended ? "Hide Recommended" : "Show Recommended"}
            </button>

            {showRecommended ? (
              <div className="flex flex-wrap gap-2.5">
                {recommendedShortcuts.map((shortcut) => (
                  <button
                    key={shortcut}
                    type="button"
                    onClick={() => applyShortcutCandidate(shortcut)}
                    className="inline-flex min-h-9 items-center rounded-full border border-border/80 bg-background px-3.5 py-1.5 text-[14px] font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
                  >
                    {formatHotkeyLabel(shortcut)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-2 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full px-6 text-[15px]"
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-11 rounded-full px-6 text-[15px]"
              onClick={handleSave}
              disabled={!candidateShortcut}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HotkeyList({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
      <div className="divide-y divide-border/70">{children}</div>
    </div>
  );
}

function formatHotkeyLabel(shortcut: string) {
  const normalized = normalizeShortcutKeys(shortcut);
  return normalized
    .split("+")
    .filter(Boolean)
    .map((key) => formatKeyForDisplay(key, isMacOS))
    .join("+");
}

function buildShortcutFromPressedTokens(tokens: Set<string>) {
  return [...tokens]
    .sort(sortHotkeyTokens)
    .join("+");
}

function sortHotkeyTokens(left: string, right: string) {
  const leftIndex = TOKEN_DISPLAY_ORDER.indexOf(left);
  const rightIndex = TOKEN_DISPLAY_ORDER.indexOf(right);

  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }
  if (leftIndex === -1) {
    return 1;
  }
  if (rightIndex === -1) {
    return -1;
  }

  return leftIndex - rightIndex;
}

function validateHotkeyCandidate(shortcut: string) {
  const parts = shortcut.split("+").filter(Boolean);

  if (parts.length === 0) {
    return { valid: false, error: "Press at least one key." };
  }

  if (parts.length > 5) {
    return { valid: false, error: "Maximum 5 keys allowed in combination." };
  }

  if (isMacOS) {
    return { valid: true as const };
  }

  if (parts.length === 1) {
    const token = parts[0];
    if (TOKEN_DISPLAY_ORDER.includes(token)) {
      return {
        valid: false,
        error:
          "Single modifier hotkeys are only supported on macOS in the current build.",
      };
    }

    return { valid: true as const };
  }

  return validateKeyCombinationWithRules(shortcut, {
    minKeys: 2,
    maxKeys: 5,
    requireModifier: true,
    requireModifierForMultiKey: true,
  });
}

function getTokenFromKeyboardEvent(event: KeyboardEvent) {
  switch (event.code) {
    case "MetaLeft":
      return "LeftCommand";
    case "MetaRight":
      return "RightCommand";
    case "ControlLeft":
      return "LeftControl";
    case "ControlRight":
      return "RightControl";
    case "AltLeft":
      return "LeftAlt";
    case "AltRight":
      return "RightAlt";
    case "ShiftLeft":
      return "LeftShift";
    case "ShiftRight":
      return "RightShift";
    case "Fn":
      return "Fn";
    default:
      break;
  }

  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) {
    return "";
  }

  const mapped = event.code ? mapCodeToKey(event.code) : event.key;

  if (mapped === "Enter") {
    return "Return";
  }

  if (mapped.length === 1) {
    return mapped.toUpperCase();
  }

  return mapped;
}
