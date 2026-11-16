// The hidden note the phone sends when the caller goes quiet. Napster echoes it back as if the
// character said it, so the phone's captions and the server's saved transcripts both drop it.
// One module for both sides (the backend imports it too), so the wording can't drift apart.
// Only the character's lines are ever checked: a player saying these words is still heard.
// No JSX or browser APIs, so Node can import it.

const SILENCE_NOTE_START = "The caller has gone silent.";

export const silenceNote = (line) =>
  `${SILENCE_NOTE_START} Say exactly this line in your own voice, and nothing else: "${line}"`;

// The character's line is (or starts with) the hidden note.
export const isSilenceNote = (text) => String(text ?? "").trimStart().startsWith(SILENCE_NOTE_START);

// A streamed line that could still turn out to be the note ("The", "The caller has"), so it
// isn't shown until enough has arrived to tell.
export const mightBeSilenceNote = (text) => {
  const t = String(text ?? "").trimStart();
  return isSilenceNote(t) || (t.length > 0 && SILENCE_NOTE_START.startsWith(t));
};
