# AI test: can a teacher's own AI suggest marks from the class export?

1 November 2026. Instructions version 0.1 (`../tools/ai.mjs`), export version 0.2 (`../tools/keys.mjs`).

**Result:** across six runs on the two sample classes (three each), every suggested point was within the reference range, and all 380 quotations were found word for word in the file. Where a call was borderline, the AI left it to the teacher with the options, as the instructions ask. These are good results, but from a narrow test (see Limits).

## How it was run

1. **Reference marking first.** `reference.json` gives a range of points for each rubric part and hand-in, from the suggested rubric and what each made-up hand-in was written to show. It was committed before any AI run.
2. **What a teacher would give their AI:** the instructions from the app's "Use your own AI" step, with the sample rubric, and the numbered export (`inputs/`). The AI never saw names: `inputs/*-numbers.json` maps numbers to the sample students and stayed with the teacher.
3. **The AI:** fresh Claude instances (the same model family as the assistant that built the app), each told to act as a school chat assistant, to read only those two files and to reply as it would in a chat. Two runs per class, then one more each after changing the instructions (step 5).
4. **Comparison** (`compare.mjs`): each suggested point against the reference range, every quotation against the file, and run 1 against run 2. The replies are in `replies/`, and the full comparison is `replies/comparison.md`.
5. **Instructions changed after runs 1 and 2.** In run 1, a student who said he couldn't place points got "try putting the volcanoes on the map" as his next step. A correct quotation from a layer pop-up was doubted because the AI can't see layer pop-ups. Two rules were added (8 and 9). Run 3 used the new instructions (`inputs/*-instructions.txt`); runs 1 and 2 used `inputs/*-instructions-runs-1-2.txt`.

## Results

| Run | Parts in the reference range | Left to the teacher ("?") | Written option under Teacher's choice | Quotations checked | Not in the file |
|---|---|---|---|---|---|
| Volcanoes 1 | 44 of 44 | 0 | 0 | 84 | 0 |
| Volcanoes 2 | 44 of 44 | 0 | 0 | 77 | 0 |
| Volcanoes 3 (new rules) | 44 of 44 | 0 | 0 | 63 | 0 |
| Oregon Trail 1 | 36 of 36 | 4 | 1 | 53 | 0 |
| Oregon Trail 2 | 36 of 36 | 3 | 1 | 50 | 0 |
| Oregon Trail 3 (new rules) | 36 of 36 | 1 | 1 | 53 | 0 |

Runs 1 and 2 gave the same points for all 44 volcano parts, and for 32 of 36 Oregon Trail parts. The 4 differences were all borderline calls where one run left a "?" with the options. Examples: a route 77% on the trail that reaches Oregon City (2 or 3), or "names on rock" for Independence Rock (1 or 2).

What the AI did well, without being told the stories:
- **Written answers.** It found the answers in Tariq's and Devon's notes and put the written-option points under Teacher's choice.
- **Misplaced point.** It counted Mina's Mount Fuji answer from her misplaced point but gave no Places point.
- **Spanish.** It accepted Sofía's Spanish answers and gave her feedback in English and Spanish.
- **Spelling.** It didn't take marks off for Caleb's spelling.
- **Problems to check.** It flagged the damaged file, the unlocked and unfinished hand-in, and Jordan's two hand-ins, and picked the later one as final.
- **Access.** It noticed that two students said they couldn't place points, and suggested the teacher look into it.

## Limits

- **One AI, not the teacher's.** The runs used Claude. Gemini and Copilot Chat weren't tested from here, and they may behave differently.
- **The reference isn't a teacher's marking.** The person who wrote the hand-ins also wrote the reference, from their intended stories. Agreement with a real teacher's marking is the test that matters.
- **Small, clean classes.** The classes had 10 and 9 hand-ins. A class of 30 with messier writing hasn't been tried.
- **Wide ranges on borderline parts.** Some reference ranges cover two values, so "in range" is easier to meet there.
- **Students may name themselves.** A student who writes their own name in a pop-up puts it in the numbered export too.
