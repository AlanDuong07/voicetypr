// Direct imports for instant desktop app experience
import { AboutTab } from "./AboutTab";
import { CyberdriverHomeTab } from "./CyberdriverHomeTab";
import { CyberdriverSettingsTab } from "./CyberdriverSettingsTab";
import { ModelsTab } from "./ModelsTab";
import { RecordingsTab } from "./RecordingsTab";
import { useEffect } from "react";
import { useEventCoordinator } from "@/hooks/useEventCoordinator";

interface TabContainerProps {
  activeSection: string;
  onSectionChange?: (section: string) => void;
}

export function TabContainer({ activeSection, onSectionChange }: TabContainerProps) {
  const { registerEvent } = useEventCoordinator("main");

  useEffect(() => {
    registerEvent("transcription-added", () => {});
    registerEvent("history-updated", () => {});
  }, [registerEvent]);

  const renderTabContent = () => {
    switch (activeSection) {
      case "home":
        return <CyberdriverHomeTab onSectionChange={onSectionChange} />;

      case "recordings":
        return <RecordingsTab />;

      case "settings":
        return <CyberdriverSettingsTab />;

      case "models":
        return <ModelsTab />;

      case "about":
        return <AboutTab />;

      default:
        return <CyberdriverHomeTab />;
    }
  };

  return (
    <div key={activeSection} className="flex h-full flex-col animate-fade-in">
      {renderTabContent()}
    </div>
  );
}
