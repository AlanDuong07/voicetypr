import { ApiKeyModal } from "@/components/ApiKeyModal";
import { LanguageSelection } from "@/components/LanguageSelection";
import { AppPage, AppPanel, AppSectionHeading } from "@/components/layout/AppPage";
import { ModelCard } from "@/components/ModelCard";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/contexts/SettingsContext";
import { getCloudProviderByModel } from "@/lib/cloudProviders";
import { cn } from "@/lib/utils";
import { ModelInfo, isCloudModel, isLocalModel } from "@/types";
import { Bot, Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Label } from "../ui/label";
import { invoke } from "@tauri-apps/api/core";

interface ModelsSectionProps {
  models: [string, ModelInfo][];
  downloadProgress: Record<string, number>;
  verifyingModels: Set<string>;
  currentModel?: string;
  onDownload: (modelName: string) => Promise<void> | void;
  onDelete: (modelName: string) => Promise<void> | void;
  onCancelDownload: (modelName: string) => Promise<void> | void;
  onSelect: (modelName: string) => Promise<void> | void;
  refreshModels: () => Promise<void>;
}

type CloudModalMode = "connect" | "update";

interface CloudModalState {
  providerId: string;
  mode: CloudModalMode;
}

export function ModelsSection({
  models,
  downloadProgress,
  verifyingModels,
  currentModel,
  onDownload,
  onDelete,
  onCancelDownload,
  onSelect,
  refreshModels,
}: ModelsSectionProps) {
  const { settings, updateSettings } = useSettings();
  const [cloudModal, setCloudModal] = useState<CloudModalState | null>(null);
  const [cloudModalLoading, setCloudModalLoading] = useState(false);

  const { availableToUse, availableToSetup } = useMemo(() => {
    const useList: [string, ModelInfo][] = [];
    const setupList: [string, ModelInfo][] = [];

    models.forEach(([name, model]) => {
      const isReady = !!model.downloaded && !model.requires_setup;
      if (isReady) {
        useList.push([name, model]);
      } else {
        setupList.push([name, model]);
      }
    });

    const sortFn = ([, a]: [string, ModelInfo], [, b]: [string, ModelInfo]) => {
      if (isLocalModel(a) && isCloudModel(b)) return -1;
      if (isCloudModel(a) && isLocalModel(b)) return 1;
      return 0;
    };
    useList.sort(sortFn);
    setupList.sort(sortFn);

    return { availableToUse: useList, availableToSetup: setupList };
  }, [models]);

  const currentEngine = (settings?.current_model_engine ?? "whisper") as
    | "whisper"
    | "parakeet"
    | "soniox";
  const currentModelName = settings?.current_model ?? "";
  const languageValue = settings?.language ?? "en";

  const isEnglishOnlyModel = useMemo(() => {
    if (!settings) return false;
    if (currentEngine === "whisper") return /\.en$/i.test(currentModelName);
    if (currentEngine === "parakeet") return currentModelName.includes("-v2");
    return false;
  }, [currentEngine, currentModelName, settings]);

  const handleLanguageChange = useCallback(
    async (value: string) => {
      try {
        await updateSettings({ language: value });
      } catch (error) {
        console.error("Failed to update language:", error);
        toast.error("Failed to update language");
      }
    },
    [updateSettings],
  );

  const activeModelLabel = useMemo(() => {
    if (!currentModel) return null;
    const entry = models.find(([name]) => name === currentModel);
    if (!entry) return currentModel;
    return entry[1].display_name || currentModel;
  }, [currentModel, models]);

  useEffect(() => {
    if (!settings) return;
    if (isEnglishOnlyModel && settings.language !== "en") {
      updateSettings({ language: "en" }).catch((error) => {
        console.error("Failed to enforce English fallback:", error);
      });
    }
  }, [isEnglishOnlyModel, settings, updateSettings]);

  const hasDownloading = useMemo(
    () => Object.keys(downloadProgress).length > 0,
    [downloadProgress],
  );
  const hasVerifying = verifyingModels.size > 0;

  const openCloudModal = useCallback(
    (providerId: string, mode: CloudModalMode) => {
      setCloudModal({ providerId, mode });
    },
    [],
  );

  const closeCloudModal = useCallback(() => {
    if (cloudModalLoading) return;
    setCloudModal(null);
  }, [cloudModalLoading]);

  const handleCloudKeySubmit = useCallback(
    async (apiKey: string) => {
      if (!cloudModal) return;
      const provider = getCloudProviderByModel(cloudModal.providerId);
      if (!provider) {
        toast.error("Unknown cloud provider");
        return;
      }
      setCloudModalLoading(true);
      try {
        await provider.addKey(apiKey);
        await refreshModels();
        toast.success(
          `${provider.providerName} key ${cloudModal.mode === "update" ? "updated" : "saved"}`,
        );
        setCloudModal(null);
        if (cloudModal.mode === "connect") {
          await Promise.resolve(onSelect(provider.modelName));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to save ${provider.providerName} key: ${message}`);
      } finally {
        setCloudModalLoading(false);
      }
    },
    [cloudModal, onSelect, refreshModels],
  );

  const handleCloudDisconnect = useCallback(
    async (modelName: string) => {
      const provider = getCloudProviderByModel(modelName);
      if (!provider) {
        toast.error("Unknown cloud provider");
        return;
      }
      try {
        await provider.removeKey();
        toast.success(`${provider.providerName} disconnected`);
        if (settings?.current_model === provider.modelName) {
          await updateSettings({
            current_model: "",
            current_model_engine: "whisper",
          });
        }
        await refreshModels();
        try { await invoke('update_tray_menu'); } catch { /* ignore */ }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to disconnect ${provider.providerName}: ${message}`);
      }
    },
    [refreshModels, settings?.current_model, updateSettings],
  );

  const activeProvider = cloudModal
    ? getCloudProviderByModel(cloudModal.providerId)
    : undefined;
  const isModalOpen = !!cloudModal && !!activeProvider;

  const renderCloudCard = useCallback(
    ([name, model]: [string, ModelInfo]) => {
      if (!isCloudModel(model)) return null;

      const provider = getCloudProviderByModel(name) ?? getCloudProviderByModel(model.engine);
      const requiresSetup = model.requires_setup;
      const isActive = currentModel === name;

      return (
        <div
          key={name}
          className={cn(
            "flex items-center justify-between gap-4 px-6 py-3.5 transition-colors",
            requiresSetup ? "" : "cursor-pointer hover:bg-accent",
            isActive && "bg-primary/5",
          )}
          onClick={() => {
            if (requiresSetup) {
              openCloudModal(name, "connect");
              return;
            }
            void onSelect(name);
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {model.display_name || provider?.displayName || name}
              </span>
              {isActive && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  Active
                </span>
              )}
              {requiresSetup && (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  Needs key
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {requiresSetup ? (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); openCloudModal(name, "connect"); }}
              >
                {provider?.setupCta ?? "Add API Key"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); handleCloudDisconnect(name); }}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      );
    },
    [currentModel, handleCloudDisconnect, onSelect, openCloudModal],
  );

  return (
    <AppPage
      title="Models"
      description="Choose a local speech model or connect a cloud provider for transcription."
      actions={
        <>
          {(hasDownloading || hasVerifying) && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
              <Download className="h-3 w-3" />
              {hasDownloading ? "Downloading" : "Verifying"}
            </span>
          )}
          {activeModelLabel && (
            <span className="text-sm text-muted-foreground">
              Active: <span className="font-medium text-foreground">{activeModelLabel}</span>
            </span>
          )}
        </>
      }
    >
      <div className="space-y-6">
        {/* Language */}
        <AppPanel>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Label htmlFor="language" className="text-sm font-medium">
                Spoken language
              </Label>
              <p className="text-sm text-muted-foreground">
                Availability depends on the selected model.
              </p>
            </div>
            <LanguageSelection
              value={languageValue}
              engine={currentEngine}
              englishOnly={isEnglishOnlyModel}
              onValueChange={(value) => void handleLanguageChange(value)}
            />
          </div>
        </AppPanel>

        {/* Model list */}
        <AppPanel className="p-0 overflow-hidden">
          {availableToUse.length > 0 && (
            <div>
              <div className="px-6 pt-5 pb-1">
                <AppSectionHeading
                  title={`Ready (${availableToUse.length})`}
                  description="Models available for immediate use."
                />
              </div>
              <div className="divide-y divide-border">
                {availableToUse.map(([name, model]) =>
                  isLocalModel(model) ? (
                    <ModelCard
                      key={name}
                      name={name}
                      model={model}
                      downloadProgress={downloadProgress[name]}
                      isVerifying={verifyingModels.has(name)}
                      onDownload={onDownload}
                      onDelete={onDelete}
                      onCancelDownload={onCancelDownload}
                      onSelect={(n) => void onSelect(n)}
                      showSelectButton={model.downloaded}
                      isSelected={currentModel === name}
                    />
                  ) : (
                    renderCloudCard([name, model])
                  ),
                )}
              </div>
            </div>
          )}

          {availableToSetup.length > 0 && (
            <div className={availableToUse.length > 0 ? "border-t border-border" : ""}>
              <div className="px-6 pt-5 pb-1">
                <AppSectionHeading
                  title={`Needs setup (${availableToSetup.length})`}
                  description="Download or connect to make these available."
                />
              </div>
              <div className="divide-y divide-border">
                {availableToSetup.map(([name, model]) =>
                  isLocalModel(model) ? (
                    <ModelCard
                      key={name}
                      name={name}
                      model={model}
                      downloadProgress={downloadProgress[name]}
                      isVerifying={verifyingModels.has(name)}
                      onDownload={onDownload}
                      onDelete={onDelete}
                      onCancelDownload={onCancelDownload}
                      onSelect={(n) => void onSelect(n)}
                      showSelectButton={model.downloaded}
                      isSelected={currentModel === name}
                    />
                  ) : (
                    renderCloudCard([name, model])
                  ),
                )}
              </div>
            </div>
          )}

          {availableToUse.length === 0 && availableToSetup.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <Bot className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No models available</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Models will appear here when detected.
                </p>
              </div>
            </div>
          )}
        </AppPanel>
      </div>

      {activeProvider && (
        <ApiKeyModal
          isOpen={isModalOpen}
          onClose={closeCloudModal}
          onSubmit={handleCloudKeySubmit}
          providerName={activeProvider.providerName}
          isLoading={cloudModalLoading}
          title={
            cloudModal?.mode === "update"
              ? `Update ${activeProvider.providerName} API Key`
              : `Add ${activeProvider.providerName} API Key`
          }
          description={
            cloudModal?.mode === "update"
              ? `Update your ${activeProvider.providerName} API key.`
              : `Enter your ${activeProvider.providerName} API key. Stored in the system keychain.`
          }
          submitLabel={cloudModal?.mode === "update" ? "Update" : "Save"}
          docsUrl={activeProvider.docsUrl}
        />
      )}
    </AppPage>
  );
}
