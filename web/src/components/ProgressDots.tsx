export default function ProgressDots({
  count,
  total = 20,
  label,
}: {
  count: number;
  total?: number;
  label?: string;
}) {
  return (
    <div
      className="dots-wrap"
      aria-label={label ? `${label}: ${count}` : `Answered ${count} questions`}
    >
      {label ? <div className="progress-caption">{label}</div> : null}
      <div className="dots">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={i < count ? "dot dot-active" : "dot"}
        />
      ))}
      </div>
    </div>
  );
}
