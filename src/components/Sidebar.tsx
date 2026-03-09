import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarPrimitive,
} from "@/components/ui/sidebar";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { cn } from "@/lib/utils";
import {
  Home,
  Info,
  Radio,
  Clock,
  Cpu,
  Settings2,
  Power,
} from "lucide-react";

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const mainSections = [
  { id: "home", label: "Home", icon: Home },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "models", label: "Models", icon: Cpu },
  { id: "recordings", label: "History", icon: Clock },
  { id: "about", label: "About", icon: Info },
];

export function Sidebar({ activeSection, onSectionChange }: SidebarProps) {
  const { status, settings, isLoading } = useCyberdriver();
  const isRunning = Boolean(status?.local_server_running || status?.tunnel_connected);

  return (
    <SidebarPrimitive >
      <SidebarContent className="px-2">
        <SidebarGroup className="flex-1">
          <SidebarMenu>
            {mainSections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <SidebarMenuItem key={section.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(section.id)}
                    isActive={isActive}
                    className={cn(
                      "group relative rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors",
                      isActive &&
                        "bg-accent text-accent-foreground font-medium",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 transition-transform group-hover:scale-110",
                        isActive && "text-primary",
                      )}
                    />
                    <span className="ml-2">{section.label}</span>
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-border/40 p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 rounded-md bg-muted/30 px-3 py-2">
            <Power className={cn("h-4 w-4", isRunning && "text-emerald-500")} />
            <span className="text-xs font-medium">
              {isLoading ? "Loading..." : isRunning ? "Cyberdriver On" : "Cyberdriver Off"}
            </span>
          </div>
          <div className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5" />
              <span>{settings?.secret ? "API key configured" : "API key missing"}</span>
            </div>
            <p className="mt-2 break-all font-mono">{status?.machine_uuid || "Machine ID loading..."}</p>
          </div>
        </div>
      </SidebarFooter>
    </SidebarPrimitive>
  );
}
