/**
 * Calculate fermentation rate (SG change per 24h based on recent data)
 */
export function calculateFermentationRate(
  sgData: Array<{ date: string; value: number; temp: number }>
): number | null {
  if (!sgData || sgData.length < 2) return null;
  
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const last24h = sgData.filter(d => new Date(d.date) >= twentyFourHoursAgo).sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  if (last24h.length >= 2) {
    const firstReading = last24h[0];
    const lastReading = last24h[last24h.length - 1];
    
    const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    
    if (timeDiffHours === 0) return null;
    
    const sgDiff = firstReading.value - lastReading.value;
    const ratePerHour = sgDiff / timeDiffHours;
    return ratePerHour * 24;
  }
  
  const last7days = sgData.filter(d => new Date(d.date) >= sevenDaysAgo).sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  const dataToUse = last7days.length >= 2 ? last7days : [...sgData].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  if (dataToUse.length < 2) return null;
  
  const firstReading = dataToUse[0];
  const lastReading = dataToUse[dataToUse.length - 1];
  
  const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
  
  if (timeDiffHours === 0) return null;
  
  const sgDiff = firstReading.value - lastReading.value;
  const ratePerHour = sgDiff / timeDiffHours;
  return ratePerHour * 24;
}

/**
 * Calculate fermentation trend by comparing recent 6h rate vs previous 6h rate
 */
export function calculateFermentationTrend(
  sgData: Array<{ date: string; value: number; temp: number }>
): { rate6h: number | null; rate12h: number | null; trend: 'rising' | 'falling' | 'stable' | null } {
  if (!sgData || sgData.length < 3) return { rate6h: null, rate12h: null, trend: null };

  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  const sorted = [...sgData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const calcRate = (data: typeof sorted): number | null => {
    if (data.length < 2) return null;
    const first = data[0];
    const last = data[data.length - 1];
    const hours = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60);
    if (hours < 1) return null;
    return ((first.value - last.value) / hours) * 24;
  };

  const recent6h = sorted.filter(d => new Date(d.date) >= sixHoursAgo);
  const prev6h = sorted.filter(d => {
    const t = new Date(d.date);
    return t >= twelveHoursAgo && t < sixHoursAgo;
  });

  const rate6h = calcRate(recent6h);
  const rate12h = calcRate(prev6h);

  let trend: 'rising' | 'falling' | 'stable' | null = null;
  if (rate6h !== null && rate12h !== null && rate12h > 0.0005 && rate6h > 0.0005) {
    const ratio = rate6h / rate12h;
    if (ratio > 1.3) trend = 'rising';
    else if (ratio < 0.7) trend = 'falling';
    else trend = 'stable';
  } else if (rate6h !== null) {
    trend = 'stable';
  }

  return { rate6h, rate12h, trend };
}

/**
 * Format runtime seconds into a human-readable string (e.g., "2h 15m" or "45m")
 */
export function formatRunTime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
