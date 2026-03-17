import { AppPage, AppPanel } from "@/components/layout/AppPage";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatHotkey } from "@/lib/hotkey-utils";
import { TranscriptionHistory } from "@/types";
import { useCanRecord, useCanAutoInsert } from "@/contexts/ReadinessContext";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Mic, Trash2, Search, Copy, Calendar, Download } from "lucide-react";
import { useState, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'large-v3-turbo': 'Large v3 Turbo',
  'large-v3-turbo-q8_0': 'Large v3 Turbo (Q8)',
  'large-v3': 'Large v3',
  'large-v3-q5_0': 'Large v3 (Q5)',
  'small.en': 'Small (English)',
  'small': 'Small',
  'base.en': 'Base (English)',
  'base': 'Base',
  'tiny.en': 'Tiny (English)',
  'tiny': 'Tiny',
};

interface RecentRecordingsProps {
  history: TranscriptionHistory[];
  hotkey?: string;
  onHistoryUpdate?: () => void;
}

export function RecentRecordings({ history, hotkey = "Cmd+Shift+Space", onHistoryUpdate }: RecentRecordingsProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const canRecord = useCanRecord();
  const canAutoInsert = useCanAutoInsert();

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const query = searchQuery.toLowerCase();
    return history.filter(item =>
      item.text.toLowerCase().includes(query) ||
      (item.model && item.model.toLowerCase().includes(query)),
    );
  }, [history, searchQuery]);

  const groupedHistory = useMemo(() => {
    const groups: Record<string, TranscriptionHistory[]> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    filteredHistory.forEach(item => {
      const itemDate = new Date(item.timestamp);
      itemDate.setHours(0, 0, 0, 0);

      let groupKey: string;
      if (itemDate.getTime() === today.getTime()) {
        groupKey = "Today";
      } else if (itemDate.getTime() === yesterday.getTime()) {
        groupKey = "Yesterday";
      } else {
        groupKey = itemDate.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          year: itemDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
        });
      }

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(item);
    });

    return groups;
  }, [filteredHistory]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const confirmed = await ask("Delete this transcription?", {
        title: "Delete Transcription",
        kind: "warning",
      });
      if (!confirmed) return;
      await invoke("delete_transcription_entry", { timestamp: id });
      toast.success("Deleted");
      onHistoryUpdate?.();
    } catch (error) {
      console.error("Failed to delete transcription:", error);
      toast.error("Failed to delete");
    }
  };

  const handleClearAll = async () => {
    if (history.length === 0) return;
    try {
      const confirmed = await ask(`Delete all ${history.length} transcriptions?`, {
        title: "Clear All",
        kind: "warning",
      });
      if (!confirmed) return;
      await invoke("clear_all_transcriptions");
      toast.success("All cleared");
      onHistoryUpdate?.();
    } catch (error) {
      console.error("Failed to clear:", error);
      toast.error("Failed to clear");
    }
  };

  const handleExport = async () => {
    if (history.length === 0) return;
    try {
      const confirmed = await ask(
        `Export ${history.length} transcription${history.length !== 1 ? 's' : ''} to JSON?`,
        { title: "Export", kind: "info" },
      );
      if (!confirmed) return;
      await invoke<string>("export_transcriptions");
      toast.success(`Exported ${history.length} transcriptions`);
    } catch (error) {
      console.error("Failed to export:", error);
      toast.error("Failed to export");
    }
  };

  return (
    <AppPage
      title="History"
      description="Past transcriptions. Click to copy."
      actions={
        <>
          {history.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{history.length} saved</span>
              <Button onClick={handleExport} size="sm" variant="outline">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </>
          )}
          {history.length > 5 && (
            <Button
              onClick={handleClearAll}
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear All
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {history.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search transcriptions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
            {searchQuery && (
              <div className="mt-1.5 text-xs text-muted-foreground">
                {filteredHistory.length} result{filteredHistory.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}

        <AppPanel className="overflow-hidden p-0">
          {history.length > 0 ? (
            filteredHistory.length > 0 ? (
              <ScrollArea className="h-full">
                <div className="divide-y divide-border">
                  {Object.entries(groupedHistory).map(([date, items]) => (
                    <div key={date}>
                      <div className="flex items-center gap-2 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {date}
                        <span className="text-muted-foreground/60">({items.length})</span>
                      </div>
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "group cursor-pointer px-4 py-3 transition-colors hover:bg-accent",
                            hoveredId === item.id && "bg-accent",
                          )}
                          onClick={() => handleCopy(item.text)}
                          onMouseEnter={() => setHoveredId(item.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-3 text-sm leading-relaxed text-foreground">
                                {item.text}
                              </p>
                              {item.model && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {MODEL_DISPLAY_NAMES[item.model] || item.model}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCopy(item.text); }}
                                className="rounded-md p-1.5 transition-colors hover:bg-muted"
                                title="Copy"
                              >
                                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              <button
                                onClick={(e) => handleDelete(e, item.id)}
                                className="rounded-md p-1.5 transition-colors hover:bg-destructive/10"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <EmptyState
                icon={<Search className="h-10 w-10 text-muted-foreground/30" />}
                title="No results"
                detail="Try a different search."
              />
            )
          ) : canRecord ? (
            <EmptyState
              icon={<Mic className="h-10 w-10 text-muted-foreground/30" />}
              title="No recordings yet"
              detail={
                canAutoInsert
                  ? `Press ${formatHotkey(hotkey)} to start.`
                  : "Accessibility permission needed for hotkeys."
              }
            />
          ) : (
            <EmptyState
              icon={<AlertCircle className="h-10 w-10 text-amber-500/50" />}
              title="Cannot record"
              detail="Check permissions and models in Settings."
            />
          )}
        </AppPanel>
      </div>
    </AppPage>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-center justify-center px-6 py-16">
      <div className="max-w-xs text-center">
        <div className="mb-3 flex justify-center">{icon}</div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
