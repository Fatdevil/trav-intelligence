import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minuter

interface IngestState {
  status: 'idle' | 'loading' | 'success' | 'error';
  lastIngest: string | null;
  message: string;
  isPolling: boolean;
}

export function useAutoIngest() {
  const [state, setState] = useState<IngestState>({
    status: 'idle',
    lastIngest: null,
    message: '',
    isPolling: true,
  });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isFetchingRef = useRef(false);

  // Hämta senaste tidsstämpeln
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ingest/status');
      const data = await res.json();
      if (data.lastIngest) {
        setState(prev => ({ ...prev, lastIngest: data.lastIngest }));
      }
    } catch {
      // Tyst — vi vill inte störa vid nätverksfel
    }
  }, []);

  // Kör ingest
  const runIngest = useCallback(async (months: number = 1) => {
    if (isFetchingRef.current) return; // Förhindra dubbla körningar
    isFetchingRef.current = true;

    setState(prev => ({ ...prev, status: 'loading', message: 'Synkar med ATG...' }));

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months }),
      });
      const data = await res.json();

      if (data.success) {
        // Hämta ny tidsstämpel direkt efter lyckad ingest
        await fetchStatus();
        setState(prev => ({
          ...prev,
          status: 'success',
          message: data.summary || 'Data synkad.',
        }));
        setTimeout(() => setState(prev => ({ ...prev, status: 'idle', message: '' })), 5000);
      } else {
        setState(prev => ({
          ...prev,
          status: 'error',
          message: data.error || 'Fel vid synk.',
        }));
        setTimeout(() => setState(prev => ({ ...prev, status: 'idle', message: '' })), 8000);
      }
    } catch {
      setState(prev => ({
        ...prev,
        status: 'error',
        message: 'Nätverksfel.',
      }));
      setTimeout(() => setState(prev => ({ ...prev, status: 'idle', message: '' })), 8000);
    } finally {
      isFetchingRef.current = false;
    }
  }, [fetchStatus]);

  // Auto-poll: kör ingest var 5:e minut
  useEffect(() => {
    // Hämta initial tidsstämpel
    fetchStatus();

    if (state.isPolling) {
      intervalRef.current = setInterval(() => {
        runIngest(1);
      }, POLL_INTERVAL);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state.isPolling, fetchStatus, runIngest]);

  // Manuell trigger
  const manualIngest = useCallback((months?: number) => {
    runIngest(months || 1);
  }, [runIngest]);

  // Toggle auto-poll
  const togglePolling = useCallback(() => {
    setState(prev => {
      if (prev.isPolling && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return { ...prev, isPolling: !prev.isPolling };
    });
  }, []);

  // Formatera tidsstämpel för UI
  const formattedTime = state.lastIngest
    ? new Date(state.lastIngest).toLocaleString('sv-SE', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return {
    ...state,
    formattedTime,
    manualIngest,
    togglePolling,
  };
}
