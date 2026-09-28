import { useEffect, useReducer, useRef, useState } from "react";
import {
  type Counters,
  type EnmaEvent,
  initialCounters,
  reduceCounters,
} from "@/lib/dashboardLogic";

export interface FeedItem {
  id: number;
  event: EnmaEvent;
  receivedAt: number;
}

const MAX_FEED_ITEMS = 100;
const RECONNECT_DELAY_MS = 2000;

type FeedState = { counters: Counters; items: FeedItem[]; nextId: number };

function feedReducer(state: FeedState, event: EnmaEvent): FeedState {
  const item: FeedItem = { id: state.nextId, event, receivedAt: Date.now() };
  return {
    counters: reduceCounters(state.counters, event),
    items: [item, ...state.items].slice(0, MAX_FEED_ITEMS),
    nextId: state.nextId + 1,
  };
}

export function useEnmaFeed() {
  const [state, dispatch] = useReducer(feedReducer, {
    counters: initialCounters(),
    items: [],
    nextId: 0,
  });
  const [connected, setConnected] = useState(false);
  const lastEventRef = useRef<FeedItem | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);

      ws.addEventListener("open", () => setConnected(true));

      ws.addEventListener("message", (msg) => {
        try {
          dispatch(JSON.parse(msg.data));
        } catch (err) {
          console.error("dashboard: failed to parse event", err);
        }
      });

      ws.addEventListener("close", () => {
        setConnected(false);
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });

      ws.addEventListener("error", () => ws?.close());
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __mockEvent: (e: EnmaEvent) => void }).__mockEvent = (e) => {
      setConnected(true);
      dispatch(e);
    };
  }, []);

  if (state.items[0]) lastEventRef.current = state.items[0];

  return {
    connected,
    counters: state.counters,
    items: state.items,
    latest: lastEventRef.current,
  };
}
