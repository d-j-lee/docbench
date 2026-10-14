# Benefits and limits

> In one line: hand over the notes you collected while reading, all at once, then confirm or revert what Claude did. Your documents stay in your folder.

## Before and after

| The usual way | With DocBench |
|---|---|
| Comments scatter across chat, mail and meeting notes | Notes attach to the exact section or phrase |
| Paragraphs are pasted into an AI chat one by one, and the results copied back | Notes collected while reading go out together, and results land in the document |
| Checking what was applied means comparing against the original again | Each round comes back sorted into edits, suggestions, questions and not done |
| Undoing an AI edit you dislike is manual work | One click on **Revert** |
| Nobody knows who changed what, when, or why | Every section keeps who changed it, when, and from which note |
| Reviewing means moving the original into another tool | The original stays the file in your folder; untouched lines keep every character and line break |

## Easy to use

- No install: open a single HTML file in Edge or Chrome. The first time, it asks for no name or folder and opens this practice space.
- Claude runs on your own subscription login. With a Claude plan that includes Claude Code there is no API key and nothing extra to pay (usage counts toward your plan).
- Writing and sending are separate steps. Think while you write, send once you have read it all — or send the urgent ones first.
- Handing work to Claude is one button in the app, or one click on **Open in Claude Code** (the first time, answer Yes when Claude Code asks whether you trust the folder).

## Works everywhere

- **Any role**: from design docs to policies and press releases, documents work the same way (see **Uses by role**). Markdown, text, CSV tables and config files (YAML, JSON, TOML) can be read and edited; Word, PowerPoint, Excel and HWPX are read as extracted text with feedback.
- **Same screen everywhere**: a single file, the app on this PC, or a tab in your company dashboard all show the same workbench, and the records carry on as long as they use the same records folder.
- **Documents as they are**: big folders such as whole drives, legacy Korean encoding (EUC-KR), and Windows line endings are handled without conversion.
- **Inside company networks**: everything the screen needs ships in the one file, so nothing has to be downloaded from the internet.

## Safe to hand over

- **Claude never edits documents itself**: it returns rewritten text in a fixed format, and DocBench applies it after checking that nothing changed meanwhile. If someone changed the same section meanwhile, it becomes a suggestion instead of overwriting.
- **Narrow permissions**: through the app, Claude runs outside the docs folder with read-only tools, so even text crafted to trick it cannot run commands or read outside the folder. Through the terminal line, the records folder's permission settings let Claude write only the result file without asking and block edits to the records; for anything else, Claude Code asks you first (with default settings).
- **Nothing is final until a person confirms**: results stay under **To review** until you confirm them, and wrong edits can be reverted.
- **Records people can read**: notes and history are plain text files (JSON) in the records folder that even Notepad opens. They stay even if you stop using the tool.

## Effects you can measure

Effects differ by team, so measure them on your own work. The feedback files in the records folder already keep when each note was written and changed; nothing extra to log.

| Measure | How | Our team |
|---|---|---|
| Time until one note is applied | From when it was written to when it was confirmed under To review | [TODO] |
| Back-and-forth per review | Number of rounds sent | [TODO] |
| Missed changes | Items not done and drafts left when a round ends | [TODO] |

One run we timed: three notes sent through the terminal line, 13.9 seconds from running the command until Claude produced the result `[measured]` (Claude Code 2.1.295, one document, 2026-10-09). The page picked up and applied the result a few seconds later.

## Common questions

- **Q:** Do company documents leave the PC?
- **A:** Not while you only use the screen (this file blocks outside connections). When you hand work to Claude, the text that work needs and whatever Claude reads in the docs folder go to Claude through your Claude account. For company documents, check your company's AI usage rules first.
- **Q:** What do I need to use the real Claude?
- **A:** A Claude plan that includes Claude Code, and Claude Code installed on this PC. Using the screen alone needs nothing.
- **Q:** Do Word or HWP files work?
- **A:** You can open them, read them and leave feedback or ask for a Claude review (their text is extracted). The original is not changed, so for documents you will keep editing together, convert to `.md` and apply the final formatting in the original program.
- **Q:** What if the AI ruins a document?
- **A:** Claude only returns rewritten text, and results stay under To review until you confirm them. One Revert takes the text back to before the edit.

## Limits

- **Office files are read only**: Word, PowerPoint, Excel and HWPX are read as extracted text with feedback — editing (by people or Claude) happens in Markdown, text, tables and config files. Text is not yet extracted from legacy `.hwp` or PDF (Claude reads PDFs directly).
- **Config and code files get proposals**: for files programs read, such as YAML, JSON or HTML, Claude does not edit directly but proposes — review the diff and apply.
- **The real Claude connects through Claude Code**: no other AI has been tried yet. Requests and results travel as files in the records folder, so a tool that returns results in the same shape has a place to plug in.
- **No live co-typing**: saves happen per section; overlapping edits show the difference and let you choose.
- **What you hand to Claude goes to Claude**: DocBench itself never sends documents anywhere, but when you send a batch, the text it needs goes to Claude through your Claude account. For company documents, follow your company's AI usage rules.
- **Phones are for looking and practice**: writing to folders needs Edge or Chrome on a PC.
- **The Claude in this practice space is simulated**: it answers by fixed rules. The real Claude works once you open a folder on a PC and connect it.
