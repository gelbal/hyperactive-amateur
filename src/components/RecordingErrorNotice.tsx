// ABOUTME: RecordingErrorNotice — shared inline alert for recording.error across app modes.
// ABOUTME: Keeps Chop and Mood recording failures on one visual/error surface pattern.
interface RecordingErrorNoticeProps {
  message: string | null;
}

export function RecordingErrorNotice({ message }: RecordingErrorNoticeProps) {
  if (!message) return null;
  return (
    <span role="alert" className="text-xs text-red-400 max-w-[80%] text-center">
      {message}
    </span>
  );
}
