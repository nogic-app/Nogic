import { Pill } from "./Pill.tsx";

const DESCRIPTION =
  "This answer was found on the web and not in your local verified database.";

export function UnverifiedWebBadge() {
  return (
    <div className="mb-2">
      <span title={DESCRIPTION} aria-label={DESCRIPTION}>
        <Pill variant="warning">⚠️ Unverified Web Result</Pill>
      </span>
    </div>
  );
}
