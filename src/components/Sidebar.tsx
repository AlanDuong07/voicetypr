import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  Sidebar as SidebarPrimitive,
} from "@/components/ui/sidebar";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Bot,
  Clock3,
  Cpu,
  Home,
  Settings2,
} from "lucide-react";

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const mainSections = [
  { id: "home", label: "Home", icon: Home },
  { id: "models", label: "Models", icon: Cpu },
  { id: "recordings", label: "History", icon: Clock3 },
];

const utilitySections = [
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "about", label: "Support", icon: BookOpen },
];

export function Sidebar({ activeSection, onSectionChange }: SidebarProps) {
  const { status } = useCyberdriver();
  const isRunning = Boolean(status?.local_server_running || status?.tunnel_connected);

  return (
    <SidebarPrimitive collapsible="none" className="shrink-0">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-1">
          <Bot className="h-5 w-5 text-foreground" />
          <span className="text-sm font-semibold text-foreground">Cyberdriver</span>
          <span
            className={cn(
              "ml-auto inline-flex h-2 w-2 rounded-full",
              isRunning ? "bg-emerald-500" : "bg-border",
            )}
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="flex-1 pt-0">
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {mainSections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <SidebarMenuItem key={section.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(section.id)}
                    isActive={isActive}
                  >
                    <Icon className={cn(isActive && "text-primary")} />
                    <span>{section.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarMenu>
            {utilitySections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <SidebarMenuItem key={section.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(section.id)}
                    isActive={isActive}
                  >
                    <Icon className={cn(isActive && "text-primary")} />
                    <span>{section.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-auto border-t border-sidebar-border pt-3">
        <p className="truncate px-1 font-mono text-[11px] text-muted-foreground">
          {status?.machine_uuid || "No machine ID"}
        </p>
      </SidebarFooter>
    </SidebarPrimitive>
  );
}
