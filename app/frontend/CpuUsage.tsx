import { useEffect, useRef, useState } from 'react';

export function CpuUsage({ cpuSeconds }: { cpuSeconds?: number }) {
  const previous = useRef<{ cpuSeconds: number; at: number } | null>(null);
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    if (cpuSeconds === undefined || !Number.isFinite(cpuSeconds)) {
      previous.current = null;
      setPercent(null);
      return;
    }
    const current = { cpuSeconds, at: performance.now() };
    const last = previous.current;
    previous.current = current;
    if (last && current.at > last.at && cpuSeconds >= last.cpuSeconds) {
      setPercent(Math.max(0, (cpuSeconds - last.cpuSeconds) * 100_000 / (current.at - last.at)));
    }
  }, [cpuSeconds]);

  return <output className="cpu-usage" aria-label="VIRA CPU usage" title="VIRA process CPU usage, as a percentage of one core; can exceed 100% on multiple cores">
    CPU: {percent === null ? '—' : `${percent.toFixed(1)}%`}
  </output>;
}
