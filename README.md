# Student Survey Status

A small, dependency-free student website with two tools:

- Private survey-completion lookup backed by administrator CSV uploads.
- A cumulative GPA and credit calculator with PIN-protected saved records.

The four built-in datasets match the supplied reports:

- Course Evaluation / 수강설문 — Round 1 and Round 2
- Major Competency / 전공능력 — Round 1 and Round 2

## Run on Windows

Requirements: Node.js 20 or newer.

1. Open PowerShell in this folder.
2. Run `./start.ps1`.
3. Choose an administrator password with at least 10 characters.
4. Open <http://127.0.0.1:3000> for student survey lookup.
5. Open <http://127.0.0.1:3000/grades> for the grade calculator.
6. Open <http://127.0.0.1:3000/admin> to upload CSV files.

You can use a different port with `./start.ps1 -Port 8080`.

## CSV format

The file must have a header named `student_id`, `student number`, `id`, `학번`, or another recognized variation.

If the file is already a completed-student list, one column is enough:

```csv
student_id
202612034
202612038
```

If a file includes both completed and incomplete students, add a recognized status column:

```csv
student_id,completed
202612034,yes
202612038,no
```

Recognized values include `yes/no`, `true/false`, `1/0`, `completed/incomplete`, and `완료/미완료`. UTF-8 and Korean EUC-KR CSV files are supported. Uploading a new file replaces the current list for that survey.

## Privacy and data

- Only normalized student IDs are saved; names and other CSV columns are discarded.
- Students receive only the four completion statuses for the ID they enter.
- Student IDs are sent in a POST body rather than placed in a URL.
- Lookup and administrator requests are rate-limited in memory.
- Saved data is stored in `data/store.json`. Back up this file if needed and keep it private.

## Grade calculator

Students open or create a record with their student ID and a 4–12 digit PIN. They can add courses, semester labels, credits, and letter grades, then save and reopen the record later.

- Supports weighted 4.5 and 4.0 GPA scales.
- Starts with Semester 1, asks only for GPA, GPA credits, and earned credits, then automatically adds the next numbered semester when the row is complete.
- Asks once for the total credits required for graduation and shows earned and remaining credits.
- Completed previous-semester rows and the graduation requirement save automatically for the student ID, so they are restored on later visits.
- Calculates a weighted average CGPA from all completed previous semesters and current courses.
- Calculates current GPA, cumulative CGPA, total GPA credits, and total earned credits.
- Includes a CGPA goal planner that asks for semesters remaining, target CGPA, and credits planned in each future semester.
- Reports whether the target is possible, the weighted future GPA required, a letter-grade target, and the maximum achievable CGPA when the goal is not possible.
- `P` adds earned credits without affecting GPA; `NP` affects neither.
- `F` counts toward GPA credits but not earned credits.
- Grade records are saved in `data/grades.json`.
- Grade-record keys contain a one-way hash of the student ID instead of the raw ID.
- PINs are salted and cryptographically hashed. There is currently no automatic PIN recovery, so students must keep their PIN.

Back up both `data/store.json` and `data/grades.json` when moving the site or server.

For an internet deployment, use HTTPS, set `ADMIN_PASSWORD` through the hosting provider's secret/environment settings, and configure persistent storage for `data/store.json`.

## Command-line start

Instead of `start.ps1`, set environment variables and run:

```powershell
$env:ADMIN_PASSWORD = 'replace-with-a-long-password'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
node server.js
```

To allow access from other devices on the same network, set `HOST` to `0.0.0.0`. Only do this on a trusted network and allow the selected port through the firewall if prompted.

## Test

```powershell
npm test
```
