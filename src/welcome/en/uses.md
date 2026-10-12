# Uses by role

> Any document written in Markdown (`.md`) works, whatever your job. Find your role in the table, then follow **How** in that section. No section for your role? Follow the closest one (QA → Engineering, Design · UX → Product · PM, Finance · Operations → Data · AI).
> This document is for practice too. Write notes, send them and revert them.

## At a glance

| Role | Typical documents | What works well |
|---|---|---|
| Engineering | Design docs · ADRs · API specs · READMEs | Collect review notes on sections, apply them in one go, check only what changed |
| Infrastructure · Ops | Runbooks · incident reports · checklists | Spot blanks (`TODO`, `TBD`) at a glance and keep a history of changed procedures |
| QA | Test plans · result reports | Batch notes per item to Claude and share the result with **Copy summary** |
| Data · AI | Experiment reports · model cards · metric definitions | Separate claims from evidence with tags like `[실측]` (measured) and `[추정]` (estimated) |
| Product · PM | Plans · PRDs · meeting notes | Each reviewer sends with **Suggest only**; the planner applies or rejects under **To review** |
| Design · UX | UX writing guides · design principles | Select one phrase and fix it with **Rewrite as** |
| Sales · Business development | Proposals · customer FAQs | Note only what changes per customer; keep shared rules in **Standing instructions** |
| Marketing · PR | Press releases · campaign briefs | Put tone and banned words in standing instructions so every round uses the same rules |
| Customer support | Support manuals · help articles | Roll a policy change into every document in the folder and share what was done with **Copy summary** |
| HR · Training | Policies · onboarding guides · course material | Note each clause to revise and apply changes one by one with **Suggest only** |
| Finance · Operations | Procedures · reports | Tag numbers with their source and fill blanks first |
| Legal · Compliance | Terms · internal policy drafts | Note per clause, let Claude only suggest; people make the final call |
| Leaders · Executives | Weekly reports · strategy documents | Use a **Reading plan** to open only what matters and get the gist in ten minutes |

## Engineering — design doc review

When review comments live in PR threads, chat and meeting notes, finding out what was applied means searching again.

**How**

1. Open the repository's `docs/` folder. Documents stay where they are; records (notes, history) are kept separately.
2. Write short notes per section as you read: "pagination is missing", "make this list a table". Star the urgent ones.
3. When you finish, pick **★ only** and send those first; send the rest together after the review.
4. Under **To review**, check what changed in each edited section, then confirm or revert. Paste a confirmed round into a commit message or PR description with **Copy summary**.

**What you get**: notes and their results stay attached to sections. Lines you did not touch keep their exact bytes and line endings, so the git diff shows only the edits.

## Infrastructure · Ops — keeping runbooks current

Runbooks get opened only during incidents, and blanks and stale steps pile up in between.

**How**

1. Open the runbook folder. Blanks such as `TODO` or `TBD` are highlighted and their count shows above the document.
2. Choose **Claude review → Suggestions and questions** and widen the scope to the documents in the same folder. Claude also flags terms and numbers that disagree between documents.
3. Answer the questions with what you know; apply suggestions after checking what changed.
4. Changed procedures land in the **Change log** (under **Workbench** on the left) with who changed them, when, and from which note.

**What you get**: runbooks are current before the incident, and "who changed this step?" has an answer.

## Data · AI — checking an experiment report

When measured and estimated numbers are mixed, readers cannot judge the report.

**How**

1. Use the (Korean) evidence tags: `[실측]` measured, `[문서]` documented, `[조사]` researched, `[추정]` estimated, `[미확인]` unverified. They show in different colors.
2. Send a **Claude review** with the note "flag numbers without a source and claims without a tag".
3. Answer the questions with sources and check the edits. Every request reminds Claude not to drop tags or invent numbers.

**What you get**: every number in the report carries its evidence, and review moves tag by tag instead of by impression.

## Product · PM — gathering notes on a plan

Merging five reviewers' comments into one plan can take half a day.

**How**

1. Open the plan's folder. The first time you save, choose **Keep inside the docs folder** for records, and everyone who opens that folder sees the same results and history (a good fit for teams sharing through git).
2. Each reviewer selects a phrase and writes a note right there; when the new wording is clear, they type it with **Rewrite as**. Unsent drafts are visible only to whoever wrote them.
3. When done, each reviewer sends with **Suggest only** and one line for the batch ("keep the conclusion, strengthen the evidence"). The document does not change yet.
4. The planner goes through each reviewer's round under **To review** and **Apply**s or **Reject**s the suggestions. Comments heard in a review meeting can be noted by the planner in place and sent together afterwards.

**What you get**: collecting, applying and confirming feedback happens in one place, and every note keeps a record of how it was applied.

## Sales · Marketing — one standard across many documents

Proposals and press releases have to keep the same tone and avoid the same words every time.

**How**

1. Write it once in **Standing instructions**: "formal tone", "never name competitors", "numbers always with a source".
2. For each document, note only what needs to change; the standing instructions go along with every batch.
3. Customer-specific versions follow the same rules, and a round summary can be pasted into the approval request.

**What you get**: the same standard goes along every time, whoever edits and however many rounds it takes.

## Customer support — one policy change, many documents

When a refund window changes, every support manual, help article and FAQ that mentions it has to change too.

**How**

1. Open the support folder and choose **Claude review → Suggestions and questions**.
2. Widen the scope to the documents in the same folder (up to ten) and write in **Focus**: "The refund window changed from 14 to 30 days. Fix every place where the old window remains."
3. Under **To review**, **Apply** or **Reject** each suggestion per document, then let the team know with **Copy summary**.

**What you get**: it is easier not to miss a document, and you can see which sentence changed in which document.

## HR · Training — revising a policy

Explaining what changed and why often takes longer than making the change.

**How**

1. Open the current policy and write a note with the reason on each clause to revise.
2. Send with **Suggest only**. The document stays as it is and the rewritten text comes back as suggestions; apply or reject them one by one after checking what changed.
3. In the revision meeting, show the diff on each suggestion card (removed and added text) as it is. Applied changes go into the **Change log** together with the note behind them, and a git folder opened in the DocBench app can also be compared against the last commit (HEAD).

**What you get**: each clause keeps the reason (note) next to the result (changed text), which makes the change notice easy to write.

## Legal · Compliance — flag, don't edit

For terms and policies, even a one-word change needs a record of what changed and why.

**How**

1. In **Standing instructions**, write "never change clause numbers or defined terms" and "if there is no source, leave `TBD`".
2. Note each clause and send with **Suggest only**. Where you only want to know whether something is right, use the **Check only** button in the note box.
3. A person checks what changed and **Apply**s or **Reject**s each suggestion. Applied changes are logged with the note behind them.

**What you get**: Claude flags and suggests; people decide what changes.

## Leaders · Executives — reading a long report fast

Ten minutes before the meeting, a thirty-page report arrives.

**How**

1. Open it and choose **Claude review → Reading plan**.
2. Claude opens the sections worth reading first and folds the rest. The document itself does not change, only your view, and you can undo it.
3. Write questions where they come up and send them together after the meeting.

**What you get**: you read the core first, and your questions sit next to the text they are about, so the author can answer right there.

## Try it on your own work

Start with one document from your own job. Press **Claude review** above the document, choose **Suggestions and questions**, and the practice Claude turns the blanks below into a question. The table has three cells, so **Reply** with three values separated by commas (e.g. weekly report, comments over chat, reading plan) and send it to fill the table.

| Document | How we review it now | One thing to try with DocBench |
|---|---|---|
| [TODO] | [TODO] | [TODO] |
