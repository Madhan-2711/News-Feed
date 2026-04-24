'use client';

import { useEffect, useRef } from 'react';

const DEFAULT_LOGS = [
  { time: '00:00:00', tag: 'INFO', message: 'System initialized. Awaiting commands.' },
  { time: '00:00:01', tag: 'OK', message: 'Connection to Supabase established.' },
  { time: '00:00:02', tag: 'INFO', message: 'NewsData.io API configured.' },
  { time: '00:00:03', tag: 'INFO', message: 'Firecrawl extraction engine ready.' },
  { time: '00:00:04', tag: 'AI', message: 'GPT-4o reasoning module online.' },
  { time: '00:00:05', tag: 'OK', message: 'All systems nominal. Ready for [ FETCH ].' },
];

export default function SystemLog({ logs, live = false }) {
  const endRef = useRef(null);
  const displayLogs = logs && logs.length > 0 ? logs : DEFAULT_LOGS;

  useEffect(() => {
    if (endRef.current && live) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayLogs.length, live]);

  return (
    <div className="system-log">
      {displayLogs.map((log, i) => (
        <div key={i} className="system-log__entry" style={{ animationDelay: `${i * 0.1}s` }}>
          <span className="system-log__time">[{log.time}]</span>
          <span className={`system-log__tag system-log__tag--${(log.tag || 'info').toLowerCase()}`}>
            {log.tag}:
          </span>
          <span className="system-log__message">{log.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
