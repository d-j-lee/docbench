# Tips

> Things worth knowing on your first day. Read from the top or unfold only what you need (key `1` for the outline, `0` for everything).

## Reading

- **Skim by depth**: key `1` shows the outline (top headings only). In documents with deeper headings, `2` and `3` open one level at a time. Folds are remembered next time.
- **Find**: press `/` to search, including inside folded sections.
- **Evidence tags**: the Korean tags `[실측]` measured, `[문서]` documented, `[조사]` researched, `[추정]` estimated and `[미확인]` unverified show in different colors, so readers see at once which numbers were measured and which are guesses.
- **Blanks**: `TODO`, `TBD`, `FIXME` and the Korean markers `[작업 후 기입]` and `[확인 필요]` are highlighted, with a count above the document.
- **Labels only**: when list lines start with a bold label such as `**Q:**` or `**A:**` and it repeats three or more times, label chips appear above the document. Click **Q** and the answer lines hide, so you can answer yourself and review (try it in "Common questions" in **Benefits and limits**).
- **Pin what you use**: pin documents and folders at the end of their row to keep them under "Working on" at the top.
- **What changed**: text changed since you last looked is marked right in the document (green for added, struck for removed, with who and when). When you have seen it, **Clear marks**.

## Writing notes

- **Anywhere**: the bubble next to a section notes the whole section, selecting text notes that phrase, and **Whole document** at the top notes the document. A long selection (over 500 characters) is noted without a quote on the section that holds it, or on the whole document if it covers most of it. A note on a folded section covers everything inside it.
- **Drafts go nowhere**: notes only collect as drafts. Edit, delete and merge them as you read (**Merge**: into one section if they share it, otherwise into one whole-document request).
- **Not sure how to phrase it**: tap a quick button (**Shorter · Clearer · Evidence · As table · Fold · Split · Remove · Check only**) or type the new text with **Rewrite as**. One line of "why" helps Claude keep your intent.
- **Ask without editing**: **Check only** adds "check whether this is right (answer only, do not edit)". Note questions as you read an unfamiliar policy or manual, send them together, and the answers collect under **To review**.
- **Urgent**: turn on ★ and you can later send **★ only** first.
- **Category**: in the note box you can pick one of Typo · Fact · Conflict · Duplicate · Missing · Structure · Clarity · Risk · Direction. Leave it empty and Claude adds one when you send; Claude never changes one you picked. Notes Claude leaves first always carry a category and a severity.
- **Nothing gets lost**: if you start another note or switch documents, what you were writing stays as a draft. Esc needs a second press to discard.
- **Keyboard**: `c` notes the current section, `Ctrl+Enter` keeps it as a draft, `Ctrl+Shift+Enter` sends just this one now.

## Sending

- **Read first, send once**: pick drafts under **Drafts** in the review panel and **Send**. They go as one request, not one by one.
- **Note for this batch**: one line for the whole batch, such as "keep the formal tone, do not touch the numbers in tables".
- **How changes are applied**: **Edit directly** applies clear requests right away (you can revert), turns big changes into suggestions and asks when unsure. **Suggest only** leaves the document as it is and sends the rewritten text back as suggestions. Your choice is remembered.
- **Standing instructions**: if you keep adding the same line, put it in **Standing instructions** once. It goes along with every batch.
- **Send via**: the DocBench app on this PC (runs in the background with a progress log), **one terminal line** (no DocBench install — your current Claude Code, one click on **Open in Claude Code**), or a dashboard tab. All of them use your own subscription login; no API key needed.

## To review

- **Round by round**: each batch you send is one round. Its header shows your note for the batch and Claude's summary.
- **Edited**: see **What changed**, then **Confirm**; if you do not like it, **Revert** (back to the text before the edit) or **Ask again**. When you send it again after reverting, Claude is told you reverted it.
- **Suggestion**: check the diff, then **Apply** or **Reject**. **Question**: **Reply**, and your answer becomes a draft that goes with the next batch.
- **Raised by Claude**: if you agree with a note, one click on **Do it** (key `a`); **Reply** to steer it; **Close** if it is not needed. Questions get a **Reply**.
- **Not done**: anything Claude could not apply comes back with the reason. **Send again** or **Back to drafts**.
- **Confirm all · Revert this round · Copy summary**: buttons on each round's header. Paste the summary into a team update or a commit message.
- **Keyboard**: open the review panel with `f` (or click inside it once), move between cards with `j` `k`, then `a` (confirm, apply, do it), `u` (revert), `r` (reply).
- **Bubbles**: turn on **Bubbles** above the document (key `b`) and feedback shows right where it points — under the selected text, under the section heading for section notes, at the top for whole-document notes. Click one to jump to its card in the review panel.
- **Filter**: the funnel button picks a severity (All · Medium and up · High only) and categories; bubbles and the review panel (except Drafts) follow it. With many notes, take **High only** first, then gather the **Typo** ones and handle them in one go. Your choice is remembered.

## Claude first

- **Suggestions and questions**: before you finish reading, Claude reads first, sends edits as suggestions and asks about what is unclear. Scope: this document, the current section, or the documents in the same folder (up to ten). With the folder scope Claude is also asked to flag what disagrees between documents (terms, numbers, duplicates).
- **Reading plan**: in a long document Claude opens what to read first and folds the rest. Only your view changes, not the document, and you can undo it. Changed sections you have not checked yet are never folded.

## Working together

- **Display name**: set a name under **Me** at the top right so others can tell who wrote and changed what.
- **Records folder**: chosen on the first save. Working alone, keep records in a records home outside the docs folder; teams sharing through git choose **Keep inside the docs folder** (`.docbench`). If you opened the HTML file by double-clicking it, each new window asks again (choose the same place and the records carry on).
- **No overwriting**: every save checks whether the document changed meanwhile. If another section changed, your edit is put back onto the latest text; if the same section changed, your text is kept and the difference is shown.
- **Drafts are yours**: unsent drafts are visible only to whoever wrote them. What people share is the results and history after sending.

## Files and environments

- **Documents stay put**: the originals are the `.md` files in your folder, and DocBench never sends them anywhere.
- **Older formats kept**: documents in legacy Korean encoding (EUC-KR) or with Windows line endings are saved back with untouched lines exactly as they were (for IT: CP949, UTF-16LE, BOM, CRLF). If you type characters that format cannot store, you are asked before saving.
- **Big folders open fast**: even a whole drive opens instantly; like an explorer, only expanded folders are read.
- **Phones**: phone and tablet browsers cannot write to folders, so they are for looking around and practice.
- **New to Markdown**: it is plain text you can write in Notepad. A line starting with `#` is a heading, and each heading starts a section (`##` is one level down). `-` starts a list item; lines split with `|` make a table. Save from Notepad with a `.md` name to make a new document.
- **Word or HWP files**: drafting and review work best in `.md`, with final formatting applied in the original program. For the conversion, ask Claude Code: "convert this Word file to .md".

## Recipes

| Situation | Do this |
|---|---|
| A long report, ten minutes before the meeting | Claude review → Reading plan → read only what is open, note questions in place |
| Twenty comments from your manager | Note each as a draft → send ★ only first → send the rest together |
| Dozens of notes from Claude | Filter **High only** → turn on bubbles and handle them while reading → next, gather the **Typo** ones and Do it |
| Action items from meeting notes | Add a `## Action items` heading with an empty table (item · owner · due), then **Whole document**: "Pull the decisions and action items from the discussion into this table; leave unknown cells as `TBD`" → Send → ask people only about the highlighted cells |
| You keep getting the same correction | Put that correction in standing instructions as one line |
| Claude's edit is not quite right | Revert → Ask again with one line of why |
| You need to announce what changed | Confirm the round, Copy summary, paste it into the notice |
| You inherited someone else's documents | Key `1` for the outline → Claude review (same folder) → answer the questions first |

## Shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Next / previous section |
| `o` | Fold or unfold the current section |
| `1` `2` `3` · `0` | Depth · all |
| `/` | Find |
| `c` | Note on the current section |
| `b` | Bubbles on or off |
| `e` | Edit the current section |
| `f` | Open or close the review panel |
| `?` | All shortcuts |
