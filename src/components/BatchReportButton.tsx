import { useState, memo } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import jsPDF from "jspdf";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { triggerFileDownload } from "@/lib/label-utils";

interface BatchReportButtonProps {
  brewId: string;
  brewName: string;
  style: string;
  og: number;
  fg: number;
  abv: number;
  attenuation: number;
  batchNumber: string;
  fermentationStart: string | null;
  status: string;
  controllerId: string | null;
}

function BatchReportButtonComponent({
  brewId,
  brewName,
  style,
  og,
  fg,
  abv,
  attenuation,
  batchNumber,
  fermentationStart,
  status,
  controllerId,
}: BatchReportButtonProps) {
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      // Fetch all data in parallel
      const [
        { data: adjustments },
        { data: stallBoosts },
        { data: stepLogs },
        { data: metrics },
      ] = await Promise.all([
        controllerId
          ? supabase
              .from("auto_cooling_adjustments")
              .select("created_at, reason, old_target_temp, new_target_temp")
              .eq("cooler_controller_id", controllerId)
              .order("created_at", { ascending: true })
              .limit(500)
          : Promise.resolve({ data: [] as { created_at: string; reason: string; old_target_temp: number; new_target_temp: number }[] }),
        // stall_boost_outcomes query removed — feature removed
        Promise.resolve({ data: [] as { created_at: string; boost_degrees: number; sg_rate_before: number; sg_rate_after: number | null; outcome: string | null }[] }),
        supabase
          .from("fermentation_step_log")
          .select("created_at, action, step_index, details")
          .order("created_at", { ascending: true })
          .limit(200),
        supabase
          .from("brew_fermentation_metrics")
          .select("*")
          .eq("brew_id", brewId)
          .maybeSingle(),
      ]);

      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();
      let y = 20;

      // ===== PAGE 1: Batch overview =====
      doc.setFontSize(20);
      doc.text(brewName, pageW / 2, y, { align: "center" });
      y += 10;
      doc.setFontSize(11);
      doc.setTextColor(120);
      doc.text(`${style} · Batch ${batchNumber}`, pageW / 2, y, { align: "center" });
      y += 15;
      doc.setTextColor(0);

      const fields = [
        ["Status", status],
        ["OG", og.toFixed(3)],
        ["FG", fg.toFixed(3)],
        ["ABV", `${abv.toFixed(1)}%`],
        ["Utjäsning", `${attenuation}%`],
        ["Jäsningsstart", fermentationStart ? format(new Date(fermentationStart), "d MMM yyyy HH:mm", { locale: sv }) : "—"],
      ];
      if (metrics) {
        fields.push(["Fas", String(metrics.fermentation_phase)]);
        fields.push(["Aktivitet", `${metrics.activity_score}%`]);
        fields.push(["Peak Δ", `${parseFloat(String(metrics.peak_delta)).toFixed(1)}°C`]);
        if (metrics.ready_to_crash) fields.push(["Cold Crash", "Redo"]);
      }

      doc.setFontSize(12);
      for (const [label, value] of fields) {
        doc.setFont("helvetica", "bold");
        doc.text(label, 20, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(value), 80, y);
        y += 7;
      }

      // ===== PAGE 2: Automation log =====
      doc.addPage();
      y = 20;
      doc.setFontSize(16);
      doc.text("Automationslogg", 20, y);
      y += 10;
      doc.setFontSize(9);

      const allEvents: { time: string; text: string }[] = [];

      for (const adj of adjustments || []) {
        allEvents.push({
          time: format(new Date(adj.created_at), "d/M HH:mm"),
          text: `${adj.reason} (${adj.old_target_temp}° → ${adj.new_target_temp}°)`,
        });
      }

      for (const boost of stallBoosts || []) {
        allEvents.push({
          time: format(new Date(boost.created_at), "d/M HH:mm"),
          text: `Stall boost +${boost.boost_degrees}°C (rate: ${parseFloat(String(boost.sg_rate_before)).toFixed(4)}/dag → ${boost.sg_rate_after ? parseFloat(String(boost.sg_rate_after)).toFixed(4) : "?"}/dag) = ${boost.outcome ?? "pending"}`,
        });
      }

      allEvents.sort((a, b) => a.time.localeCompare(b.time));

      for (const evt of allEvents.slice(0, 80)) {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold");
        doc.text(evt.time, 15, y);
        doc.setFont("helvetica", "normal");
        const lines = doc.splitTextToSize(evt.text, pageW - 60);
        doc.text(lines, 45, y);
        y += lines.length * 4 + 2;
      }

      // ===== PAGE 3: Step log =====
      if (stepLogs && stepLogs.length > 0) {
        doc.addPage();
        y = 20;
        doc.setFontSize(16);
        doc.text("Profilsteg-logg", 20, y);
        y += 10;
        doc.setFontSize(9);

        for (const log of stepLogs.slice(0, 60)) {
          if (y > 275) { doc.addPage(); y = 20; }
          doc.setFont("helvetica", "bold");
          doc.text(format(new Date(log.created_at), "d/M HH:mm"), 15, y);
          doc.setFont("helvetica", "normal");
          const details = log.details ? ` (${JSON.stringify(log.details).slice(0, 80)})` : "";
          doc.text(`Step ${log.step_index}: ${log.action}${details}`, 45, y);
          y += 5;
        }
      }

      // Footer on last page
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Genererad ${format(new Date(), "d MMM yyyy HH:mm", { locale: sv })} · Brew Monitor`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: "center" }
      );

      doc.save(`${brewName.replace(/\s+/g, "_")}_rapport.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={generate}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <FileText className="h-3.5 w-3.5" />
      {loading ? "Genererar..." : "Rapport"}
    </Button>
  );
}

export const BatchReportButton = memo(BatchReportButtonComponent);
