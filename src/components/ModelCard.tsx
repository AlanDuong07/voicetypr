import { CheckCircle, Download, HardDrive, Loader2, Star, X, Zap, Trash2 } from 'lucide-react';
import { ModelInfo, isLocalModel } from '../types';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { cn } from '@/lib/utils';

interface ModelCardProps {
  name: string;
  model: ModelInfo;
  downloadProgress?: number;
  isVerifying?: boolean;
  isSelected?: boolean;
  onDownload: (name: string) => void;
  onSelect: (name: string) => void;
  onDelete?: (name: string) => void;
  onCancelDownload?: (name: string) => void;
  showSelectButton?: boolean;
}

export const ModelCard = function ModelCard({
  name,
  model,
  downloadProgress,
  isVerifying = false,
  isSelected = false,
  onDownload,
  onSelect,
  onDelete,
  onCancelDownload,
  showSelectButton = true,
}: ModelCardProps) {
  if (!isLocalModel(model)) {
    console.warn(`[ModelCard] Skipping non-local model card for ${model.name}`);
    return null;
  }

  const formatSize = () => {
    const sizeInMB = model.size / (1024 * 1024);
    return sizeInMB >= 1024
      ? `${(sizeInMB / 1024).toFixed(1)} GB`
      : `${Math.round(sizeInMB)} MB`;
  };

  const isUsable = model.downloaded;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-6 py-3.5 transition-colors",
        isUsable && "cursor-pointer hover:bg-accent",
        isSelected && "bg-primary/5",
      )}
      onClick={() => isUsable && showSelectButton && onSelect(name)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {model.display_name || name}
          </span>
          {model.recommended && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              Recommended
            </span>
          )}
          {isSelected && (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              Active
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {model.speed_score}
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            {model.accuracy_score}
          </span>
          <span className="inline-flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            {formatSize()}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {model.downloaded ? (
          onDelete && (
            <Button
              onClick={(e) => { e.stopPropagation(); onDelete(name); }}
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )
        ) : isVerifying ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Verifying
          </span>
        ) : downloadProgress !== undefined ? (
          <div className="flex items-center gap-2">
            {model.engine === 'parakeet' && downloadProgress === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Downloading
              </span>
            ) : (
              <div className="flex min-w-[100px] items-center gap-2">
                <Progress value={downloadProgress} className="h-1.5 flex-1" />
                <span className="w-8 text-right text-xs font-medium tabular-nums text-foreground">
                  {Math.round(downloadProgress)}%
                </span>
              </div>
            )}
            {onCancelDownload && (
              <Button
                onClick={(e) => { e.stopPropagation(); onCancelDownload(name); }}
                variant="ghost"
                size="icon"
                className="h-7 w-7"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ) : (
          <Button
            onClick={(e) => { e.stopPropagation(); onDownload(name); }}
            variant="outline"
            size="sm"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        )}
      </div>
    </div>
  );
};
