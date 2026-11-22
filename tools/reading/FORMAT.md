# Reading passage format (one JSON array per file)

Workplace reading for a Vietnamese software/AI engineer working in English (TOEIC Part 7 style):
emails, reports, memos, notices, chat threads, meeting minutes, job posts, short articles.
Every English sentence carries a natural Vietnamese translation, and each passage reviews words from the app's deck.

Each passage object:
{
  "id": "r1-01",                 // r<level>-<NN>; level 1 = Dễ, 2 = Trung bình, 3 = Khó
  "level": 1,
  "type": "email",               // email | report | memo | notice | chat | minutes | article | job | review
  "topic": "IT",                 // short English tag: IT, HR, Finance, Sales, Logistics, Events, Office, Travel, Legal, Service, Product, Data
  "title": "New laptop policy",  // short English title
  "title_vi": "Chính sách laptop mới",
  "head": [["From", "Anna Lee <anna@brightpixel.com>"], ["To", "All staff"], ["Subject", "New laptop policy"]],
                                 // optional header rows (email/memo/minutes); omit or [] for others. Fictional names/companies only.
  "paras": [                     // paragraphs; each paragraph = list of [english sentence, vietnamese translation]
    [["Hi team,", "Chào cả nhóm,"]],
    [["Starting next Monday, all laptops must be returned to IT for an update.", "Bắt đầu từ thứ Hai tới, tất cả laptop phải được gửi lại cho bộ phận IT để cập nhật."],
     ["...", "..."]]
  ],
  "vocab": [                     // 6-12 words/chunks from the deck that appear in the text, to review
    {"w": "policy"},             // w = EXACT deck headword (see vocab3000.js, column 2)
    {"w": "return", "f": "returned"}   // f = the exact form used in the text when it differs (case-insensitive)
  ],
  "questions": [                 // level 1: 3 questions, level 2-3: 4 questions
    {"q": "Why must staff return their laptops?",
     "o": ["To get new ones", "For an update", "For a security check", "Because they are broken"],
     "a": 1,                     // index 0-3 of the correct option; spread answers across A-D
     "vi": "Giải thích ngắn bằng tiếng Việt, chỉ ra câu chứa đáp án và bẫy."}
  ]
}

Length (English words in paras): level 1: 80-140, level 2: 150-230, level 3: 240-340.
Level 1: short simple sentences, common words. Level 2: normal business English, some inference.
Level 3: dense report/article style, numbers/tables in prose, inference and "NOT mentioned" or vocabulary-in-context questions
(e.g. 'The word "address" in paragraph 2, line 1, is closest in meaning to').
Questions ask for gathered information: deadlines, who is responsible, what changed, why, next step, numbers.
Translations: natural Vietnamese (not word-by-word), keep names/numbers, keep tech terms as Vietnamese engineers say them.
Find deck words with e.g.  grep -o '\[[0-9]*,"[^"]*"' vocab3000.js | grep -w deadline
Validate:  python3 tools/reading/check.py tools/reading/<your file>.json
