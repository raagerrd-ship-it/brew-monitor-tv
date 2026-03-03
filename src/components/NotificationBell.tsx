import { useState, useEffect, useCallback, memo } from "react";
import { Bell } from "lucide-react";
import { useIsMobile } from "@/hooks";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  brew_id: string | null;
  controller_id: string | null;
}

const TYPE_ICONS: Record<string, string> = {
  stall_boost: "🔥",
  ready_to_crash: "🧊",
  delta_alert: "⚠️",
  profile_completed: "✅",
  rapt_api_degraded: "📡",
};

function NotificationBellComponent() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const isMobile = useIsMobile();

  // Check push permission state on mount
  useEffect(() => {
    if ("Notification" in window) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, []);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    const { data } = await supabase
      .from("pending_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data as Notification[]);
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription for new notifications
  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pending_notifications" },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev].slice(0, 50));

          // Browser push notification
          if (
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            const icon = TYPE_ICONS[newNotif.type] || "🔔";
            new Notification(`${icon} ${newNotif.title}`, {
              body: newNotif.body,
              icon: "/brew-icon.png",
              tag: newNotif.id,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Mark all as read
  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read_at);
    if (unread.length === 0) return;
    
    const ids = unread.map((n) => n.id);
    await supabase
      .from("pending_notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    
    setNotifications((prev) =>
      prev.map((n) =>
        ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n
      )
    );
  }, [notifications]);

  // Clear old read notifications
  const clearRead = useCallback(async () => {
    const readIds = notifications.filter((n) => n.read_at).map((n) => n.id);
    if (readIds.length === 0) return;
    
    await supabase
      .from("pending_notifications")
      .delete()
      .in("id", readIds);
    
    setNotifications((prev) => prev.filter((n) => !n.read_at));
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) markAllRead(); }}>
      <DialogTrigger asChild>
        <div className="relative flex items-center justify-center" style={{ width: "40px", height: "40px" }}>
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full opacity-40 hover:opacity-100"
          >
            <Bell className="transition-colors duration-200" style={{ width: "50%", height: "50%" }} />
          </Button>
          {unreadCount > 0 && (
            <span
              className="absolute top-1 right-1 flex items-center justify-center rounded-full font-bold text-white"
              style={{
                width: "16px",
                height: "16px",
                fontSize: "9px",
                background: "hsl(0 70% 50%)",
                boxShadow: "0 0 8px hsl(0 70% 50% / 0.6)",
              }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-md pt-4 [&>button]:top-4 [&>button]:right-4">
        <DialogHeader className="space-y-0">
          <DialogTitle className="flex items-center gap-3 pr-8">
            <span>Notifikationer</span>
            {notifications.some((n) => n.read_at) && (
              <Button variant="ghost" size="sm" onClick={clearRead} className="text-xs text-muted-foreground">
                Rensa lästa
              </Button>
            )}
            {isMobile && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground">Push</span>
                <Switch
                  checked={pushEnabled}
                  disabled={pushLoading || ("Notification" in window && Notification.permission === "denied")}
                  onCheckedChange={async (checked) => {
                    if (checked) {
                      setPushLoading(true);
                      try {
                        const { requestAndRegisterPush } = await import("@/lib/web-push-registration");
                        const ok = await requestAndRegisterPush();
                        setPushEnabled(ok);
                      } catch {
                        setPushEnabled(false);
                      } finally {
                        setPushLoading(false);
                      }
                    }
                  }}
                />
              </div>
            )}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              Inga notifikationer
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                    n.read_at ? "opacity-50" : "bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{TYPE_ICONS[n.type] || "🔔"}</span>
                    <span className="font-medium flex-1">{n.title}</span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                        locale: sv,
                      })}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5 ml-6">
                    {n.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export const NotificationBell = memo(NotificationBellComponent);
