export function ComingSoon({ screen }: { screen: string }) {
  return (
    <div className="pkp-card" style={{ padding: 40, textAlign: 'center' }}>
      <h3 className="pkp-h3" style={{ marginBottom: 8 }}>{screen}</h3>
      <p style={{ fontSize: 13.5, color: 'var(--ink-500)', margin: 0 }}>
        Designed in the prototype — next vertical to build on this same data layer.
      </p>
    </div>
  );
}
