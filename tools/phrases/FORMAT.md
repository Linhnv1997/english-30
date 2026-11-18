# Phrase / chunk format (JSON array)

{
  "w":  "take a look at",        // the phrase in standard spelling, lowercase unless a proper noun or "I"; this is the card ID, keep it unique
  "sp": "",                       // Spoken only: how it really sounds in fast speech, e.g. "wanna", "lemme know", "whaddya think"; "" otherwise
  "ipa": "",                      // Spoken only: IPA of the reduced form between slashes, e.g. "/ˈwɑnə/"; "" otherwise
  "vi": "xem qua, kiểm tra",      // short Vietnamese meaning, max ~8 words
  "ex": "Could you take a look at my pull request?",  // one natural workplace sentence, max 14 words; for Spoken items write it with the reduced spelling ("I'm gonna send it by noon.")
  "topic": "...",                  // one of the topic names given in your brief
  "src": "Chunk" | "Spoken"
}
