import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppPage, AppPanel, AppSectionHeading } from "@/components/layout/AppPage";
import { open } from '@tauri-apps/plugin-shell';
import { getVersion } from '@tauri-apps/api/app';
import {
  BookOpen,
  ExternalLink,
  Globe,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { updateService } from '@/services/updateService';

export function AboutSection() {
  const [appVersion, setAppVersion] = useState<string>('');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const version = await getVersion();
        setAppVersion(version);
      } catch (error) {
        console.error('Failed to get app version:', error);
        setAppVersion('Unknown');
      }
    };
    fetchVersion();
  }, []);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    await updateService.checkForUpdatesManually();
    setIsCheckingUpdate(false);
  };

  const openExternalLink = async (url: string) => {
    try {
      await open(url);
    } catch (error) {
      console.error('Failed to open link:', error);
      toast.error('Failed to open link');
    }
  };

  return (
    <AppPage
      title="Support"
      description="Version info, updates, and documentation."
    >
      <div className="space-y-6">
        <AppPanel>
          <AppSectionHeading
            title="Application"
            action={
              <Button
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
                variant="outline"
                size="sm"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
              </Button>
            }
          />
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Version</span>
              <Badge variant="outline" className="font-mono text-xs">
                v{appVersion || 'Loading...'}
              </Badge>
            </div>
          </div>
        </AppPanel>

        <div className="grid gap-4 sm:grid-cols-2">
          <LinkCard
            icon={<Globe className="h-4 w-4" />}
            title="Website"
            subtitle="cyberdesk.io"
            onClick={() => openExternalLink("https://www.cyberdesk.io")}
          />
          <LinkCard
            icon={<BookOpen className="h-4 w-4" />}
            title="Docs"
            subtitle="Quickstart and setup"
            onClick={() => openExternalLink("https://docs.cyberdesk.io/cyberdriver/quickstart")}
          />
        </div>
      </div>
    </AppPage>
  );
}

function LinkCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}
