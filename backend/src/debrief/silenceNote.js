// When the caller goes quiet, the phone sends the character a hidden note ("The caller has gone
// silent. Say exactly this line...", see frontend/src/phone/callSession.js). Napster records it
// in the transcript as if the character said it, so transcripts drop it before anyone sees it.
export const SILENCE_NOTE_START = "The caller has gone silent.";

export const isSilenceNote = (text) => String(text ?? "").trimStart().startsWith(SILENCE_NOTE_START);
