import { Card } from "@/components/ui/card";
import { BrewStats } from "./BrewStats";
import { BrewChart } from "./BrewChart";
import { useEffect, useState } from "react";

interface BrewData {
  id: string;
  name: string;
  style: string;
  batchNumber: string;
  status: string;
  currentSG: number;
  currentTemp: number;
  attenuation: number;
  abv: number;
  originalGravity: number;
  finalGravity: number;
  lastUpdate: string;
  sgData: Array<{ date: string; value: number; temp: number }>;
}

const BREW_DATA: BrewData[] = [
  {
    id: "1",
    name: "Czech Pilsner",
    style: "Czech Premium Pale Lager",
    batchNumber: "#92",
    status: "Konditionering",
    currentSG: 1.010,
    currentTemp: 12,
    attenuation: 80,
    abv: 5.4,
    originalGravity: 1.050,
    finalGravity: 1.010,
    lastUpdate: "22 Sep 2025 13:33",
    sgData: [
      { date: "31 Aug", value: 1.050, temp: 18 },
      { date: "1 Sep", value: 1.048, temp: 17 },
      { date: "2 Sep", value: 1.044, temp: 16 },
      { date: "3 Sep", value: 1.038, temp: 15 },
      { date: "4 Sep", value: 1.032, temp: 14 },
      { date: "5 Sep", value: 1.026, temp: 14 },
      { date: "6 Sep", value: 1.022, temp: 13 },
      { date: "7 Sep", value: 1.018, temp: 13 },
      { date: "8 Sep", value: 1.016, temp: 13 },
      { date: "10 Sep", value: 1.014, temp: 12 },
      { date: "12 Sep", value: 1.012, temp: 12 },
      { date: "15 Sep", value: 1.011, temp: 12 },
      { date: "18 Sep", value: 1.010, temp: 12 },
      { date: "22 Sep", value: 1.010, temp: 12 },
    ],
  },
  {
    id: "2",
    name: "Holy Helles!",
    style: "Munich Helles",
    batchNumber: "#93",
    status: "Klar",
    currentSG: 1.007,
    currentTemp: 7.7,
    attenuation: 82,
    abv: 4.5,
    originalGravity: 1.044,
    finalGravity: 1.007,
    lastUpdate: "15 Sep 2025 15:16",
    sgData: [
      { date: "8 Sep", value: 1.044, temp: 16 },
      { date: "9 Sep", value: 1.036, temp: 14 },
      { date: "10 Sep", value: 1.026, temp: 12 },
      { date: "11 Sep", value: 1.018, temp: 10 },
      { date: "12 Sep", value: 1.012, temp: 9 },
      { date: "13 Sep", value: 1.009, temp: 8 },
      { date: "14 Sep", value: 1.008, temp: 8 },
      { date: "15 Sep", value: 1.007, temp: 7.7 },
    ],
  },
];

export function BrewingDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen w-full bg-background p-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-5xl font-bold bg-gradient-beer bg-clip-text text-transparent">
          Bryggövervakare
        </h1>
        <p className="text-xl text-muted-foreground">
          {currentTime.toLocaleDateString("sv-SE", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          {currentTime.toLocaleTimeString("sv-SE", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-2 gap-6">
        {BREW_DATA.map((brew) => (
          <div key={brew.id} className="space-y-6">
            {/* Brew Header Card */}
            <Card className="bg-gradient-card border-border p-6 shadow-deep">
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-bold text-foreground">
                    {brew.name}
                  </h2>
                  <span
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                      brew.status === "Konditionering"
                        ? "bg-primary/20 text-primary"
                        : "bg-ferment-green/20 text-ferment-green"
                    }`}
                  >
                    {brew.status}
                  </span>
                </div>
                <p className="mt-2 text-lg text-muted-foreground">
                  {brew.style} • Sats {brew.batchNumber}
                </p>
              </div>

              {/* Current Stats */}
              <BrewStats brew={brew} />
            </Card>

            {/* Charts */}
            <Card className="bg-gradient-card border-border p-6 shadow-deep">
              <h3 className="mb-4 text-xl font-semibold text-foreground">
                Jäsningsförlopp
              </h3>
              <BrewChart data={brew.sgData} og={brew.originalGravity} fg={brew.finalGravity} />
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
