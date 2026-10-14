# Getting started with DocBench

A workbench where people and Claude read **the same documents**, trade feedback, and keep a record of every change.
Documents stay in folders on this PC, and DocBench never sends them anywhere (only when you hand work to Claude does the text that work needs go to Claude through your own Claude account).

## 1. Open a folder

Click **Getting started** (the name of this workspace) at the top left and choose **Open folder…**.

- Even a whole drive opens instantly — like an explorer, only **expanded folders** are read.
- Opening a folder starts at the **Overview** — what this workspace is for (the first paragraph of the top README), what is in it, and what is worth a look (files that look like secrets, version copies, broken links, review dates …). **Workbench › Overview** on the left brings you back any time.
- Click a document to open it — Markdown, config files such as YAML and JSON (each key is a section), CSV tables, text and logs, Word, PowerPoint, Excel, HWPX and Jupyter (text extracted, read only), PDFs and images. Files DocBench does not open are dimmed (code is left out by default).
- **Pin** folders and documents you use often; they stay under "Working on" at the top.
- Phone and tablet browsers cannot write to folders, so they are for **looking around and practice** only. Open your own documents and run Claude jobs in Edge or Chrome on a PC.

## 2. Read and jot down

- A document splits into **sections** at each heading (a heading and the text under it). Key `1` shows only the outline, `0` shows everything.
- Click the bubble next to a section, or select text, and a **small box opens right there**. What you write collects as **drafts** — nothing goes anywhere yet. Edit, delete and merge them as you read.
- Not sure how to phrase it? Use **Rewrite as** to type the text you want, or tap *Shorter · Evidence · As table* and the like. Mark urgent ones with **★**.
- You can also edit directly (section by section). If someone or another program changed the same place meanwhile, you see the difference and choose.

The first time you save, choose a **records folder** (where feedback and history live). Nothing is created in your docs folder. If you opened the HTML file by double-clicking it, each new window asks for the docs folder and the records folder again (choose the same place and the records carry on).

## 3. Back and forth with Claude

- When you are done reading, pick what to send under **Drafts** in the review panel (or just the ★ ones first), add one line for the whole batch, and **Send**. They go together, not one by one.
- With **Edit directly** (default) Claude edits the documents; with **Suggest only** it proposes the edited text. Results collect under **To review**, round by round — confirm, revert or ask again per item.
- Before you read it all, ask **Claude review** for suggestions and questions first, or for a **reading plan** of a long document (what to fold, where to start).
- Notes and questions Claude raises on its own collect under **To review** as "Raised by Claude". If you agree with a note, one click on **Do it**; for a question, **Reply**.

| Connection | What happens | Needs |
|---|---|---|
| One terminal line | Sending shows a single command. Paste it into PowerShell; Claude Code handles it in the records folder and this page applies the result | Claude Code (no DocBench install) |
| Right here | Runs in the background; progress shows in the bottom panel | DocBench app (one prompt to install) |
| In a dashboard | Drop it into your dashboard as a tab | DocBench app + one line |

Claude runs on **your subscription login** — no API key. It never edits documents itself; it returns results, and DocBench checks that nothing changed meanwhile, applies them and keeps the history.

> In this practice space a **simulated Claude** answers (nothing is sent). **Reply** to the **Schedule** question on the practice plan with values (e.g. Nov 3–14, Kim) and send it, or make a few drafts with "Rewrite as" and send them together — you will see edit → To review → revert. Try **Claude review** above too.

## 4. Name and account

No name is asked. An account is created in this browser automatically; click **Me** at the top right to set a display name (useful when several people share a folder).

## 5. Look around

The **Guides** folder on the left has three more documents. They are practice documents too, so feel free to write notes and send them.

- **Uses by role** — how each role uses it, from engineering to HR, legal and leadership
- **Tips** — reading, notes, sending and reviewing at a glance, with recipes and shortcuts
- **Benefits and limits** — what changes, how to measure it, common questions, and what does not work yet
