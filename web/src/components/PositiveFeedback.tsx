export default function PositiveFeedback({
  visible,
  message = "Great effort. Let’s keep going.",
}: {
  visible: boolean;
  message?: string;
}) {
  if (!visible) return null;

  return (
    <div className="success-box center">
      {message}
    </div>
  );
}
