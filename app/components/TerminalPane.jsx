export default function TerminalPane({ title, children, scrollable = true, loading = false }) {
  return (
    <div className="pane">
      <div className="pane__header">
        <span className="pane__header-line" />
        <span className="pane__header-title">{title}</span>
        <span className="pane__header-line" />
      </div>
      <div className="pane__body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 0' }}>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>Loading</p>
            <div className="loading-bar" style={{ maxWidth: '180px', margin: '0 auto' }}>
              <div className="loading-bar__progress" />
            </div>
          </div>
        ) : children}
      </div>
    </div>
  );
}
