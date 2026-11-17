# Listening lesson format (one JSON array per file)

Each lesson object:
{
  "id": "p3-01",              // p3-01..p3-30 or p4-01..p4-30
  "part": 3,                  // 3 = conversation, 4 = talk
  "level": 2,                 // 1 easy (TOEIC ~600), 2 medium (~750), 3 hard (~900)
  "topic": "IT",              // short English tag, e.g. IT, HR, Finance, Sales, Logistics, Events, Office, Travel, Legal, Service
  "title": "Sprint deadline moved",      // short English title
  "title_vi": "Dời hạn sprint",          // short Vietnamese title
  "speakers": {"A": "M-US", "B": "F-GB"},  // gender M/F + accent US/GB/AU; Part 4 has exactly one speaker "A"
  "lines": [["A", "text..."], ["B", "text..."]],
  "questions": [
    {"q": "When is the new deadline?",
     "o": ["On Monday", "On Wednesday", "On Thursday", "At the end of the month"],
     "a": 2,                  // index 0-3 of the correct option
     "ev": [3],               // indices into "lines" that contain the answer
     "vi": "Giải thích ngắn bằng tiếng Việt: vì sao đáp án đúng, bẫy ở đâu."}
  ]
}
