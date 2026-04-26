import type { ComponentType } from "react";
import { ArchiveIcon, ArrowLeftIcon, Link2Icon, Settings2Icon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "../ui/sidebar";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/connections"
  | "/settings/archived";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Connections", to: "/settings/connections", icon: Link2Icon },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
];

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-3 py-3">
          <SidebarMenu>
            {SETTINGS_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    size="default"
                    isActive={isActive}
                    className={
                      isActive
                        ? "h-10 gap-2.5 rounded-lg border border-border/70 bg-accent px-3 text-left text-sm font-medium text-foreground"
                        : "h-10 gap-2.5 rounded-lg border border-border/55 bg-background/35 px-3 text-left text-sm text-muted-foreground hover:border-border/75 hover:bg-accent hover:text-foreground"
                    }
                    onClick={() => void navigate({ to: item.to, replace: true })}
                  >
                    <Icon
                      className={
                        isActive
                          ? "size-4 shrink-0 text-foreground"
                          : "size-4 shrink-0 text-muted-foreground/60"
                      }
                    />
                    <span className="truncate">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="default"
              className="h-10 gap-2 rounded-lg border border-border/70 bg-background/45 px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => window.history.back()}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
