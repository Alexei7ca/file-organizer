# 📦 File Organizer CLI (`file-organizer`)

A command-line interface (CLI) tool built with native **Node.js ES Modules** for recursive directory scanning, streaming **SHA-256** duplicate detection, non-destructive categorized file organization, and age-based file cleanup.

---

## ✨ Features & Technical Highlights

- **`scan` — Recursive Directory Analytics:** Traverses nested directories using `fs/promises`, computing total file count, total storage size, distribution by file extension, file age brackets (`<= 7 days`, `<= 30 days`, `> 90 days`), top-3 largest files, and the oldest file.
- **`duplicates` — Streaming SHA-256 Duplicate Detection:** Computes cryptographic `sha256` hashes via `crypto.createHash('sha256')` and `fs.createReadStream()` (never loading entire files into memory with `fs.readFile`), groups identical files regardless of filename or subfolder location, and calculates wasted disk space per group and in total.
- **`organize` — Categorized Non-Destructive File Copying:** Sorts and copies files into `Documents`, `Images`, `Archives`, `Code`, `Videos`, and `Other` folders while leaving source files untouched:
  - Uses `fs.copyFile()` for files `< 10 MB`.
  - Uses `pipeline(fs.createReadStream(), fs.createWriteStream())` from `stream/promises` for large files `>= 10 MB` with automatic backpressure management.
  - Prevents accidental overwrites by resolving filename collisions with incremental suffixes (`notes.txt` ➔ `notes(1).txt` ➔ `notes(2).txt`).
- **`cleanup` — Safe Age-Based File Cleanup:** Filters files older than `--older-than <days>` using `stats.mtime`. Runs in safe **Dry Run Mode** by default and only executes `fs.unlink()` when `--confirm` is explicitly provided.
- **`EventEmitter` Architecture:** All four core domain classes (`Scanner`, `DuplicateFinder`, `Organizer`, `Cleanup`) inherit from Node's built-in `EventEmitter`, decoupling filesystem logic from CLI progress bar rendering (`█`/`░`).
- **Defensive Error Handling:** Wraps all asynchronous I/O in `try...catch` blocks with human-readable diagnostics for POSIX error codes (`ENOENT`, `EACCES`, `EPERM`, `ENOTDIR`, `EISDIR`) and exits with code `1` on fatal errors.

---

## 📂 Project Structure

```text
file-organizer/
├── package.json          # ES Module configuration ("type": "module") and npm scripts
├── .gitignore            # Excludes node_modules, OS artifacts, logs, and temporary files
├── README.md             # Project documentation, CLI reference, and sample outputs
├── file-organizer.js     # Main CLI entrypoint, argument parser, and EventEmitter subscribers
└── lib/
    ├── scanner.js        # Scanner class (extends EventEmitter) + size & progress utilities
    ├── duplicates.js     # DuplicateFinder class (extends EventEmitter) + streaming SHA-256
    ├── organizer.js      # Organizer class (extends EventEmitter) + stream pipeline & collision resolver
    └── cleanup.js        # Cleanup class (extends EventEmitter) + dry-run and confirmed unlink
```

---

## 🚀 Installation & Setup

### Prerequisites
- **Node.js** v18.0.0 or higher (tested on Node.js LTS / v24.13.0)
- Zero external runtime dependencies — relies exclusively on built-in Node.js modules (`fs/promises`, `fs`, `path`, `crypto`, `events`, `stream/promises`).

### Setup
1. Clone the repository and navigate into the project directory:
   ```bash
   git clone https://github.com/Alexei7ca/file-organizer.git
   cd file-organizer
   ```
2. View available commands and help:
   ```bash
   node file-organizer.js --help
   ```

---

## 🛠️ Usage & CLI Commands

You can invoke the tool directly with `node file-organizer.js <command>` or via `npm run <command> -- <args>`.

---

### 1. `scan` — Analyze Directory Statistics

Recursively scans a directory and prints a comprehensive breakdown of file types, modification ages, largest files, and oldest file.

#### Syntax
```bash
node file-organizer.js scan <directory>
# or via npm:
npm run scan -- <directory>
```

#### Example Output
```text
📂 Scanning: /tmp/file-organizer-sandbox/Downloads
Processing... ████████████████████ 14/14 files

📊 Scan Results:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total files: 14
Total size: 12.4 MB

By File Type:
  .mp4          1 file    11.0 MB
  .pdf         4 files   616.0 KB
  .zip          1 file   512.0 KB
  .png         2 files   160.0 KB
  .docx        2 files   100.0 KB
  .customext    1 file    25.0 KB
  .txt         2 files    22.0 KB
  .js           1 file    15.0 KB

File Age:
  Last 7 days:    7 files
  Last 30 days:   11 files
  Older than 90:  3 files

Largest files:
  1. video_lecture.mp4        11.0 MB
  2. archive_backup.zip       512.0 KB
  3. old_report.pdf           256.0 KB

Oldest file: old_report.pdf (modified 365 days ago)
```

---

### 2. `duplicates` — Find Duplicate Files by Content (SHA-256)

Calculates SHA-256 hashes for all files using `fs.createReadStream()` and groups files with identical content regardless of their names or directory depth.

#### Syntax
```bash
node file-organizer.js duplicates <directory>
# or via npm:
npm run duplicates -- <directory>
```

#### Example Output
```text
🔍 Searching for duplicates in: /tmp/file-organizer-sandbox/Downloads
Calculating hashes... ████████████████████ 14/14 files

Found 3 duplicate groups (370.0 KB wasted):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 1 (3 copies, 120.0 KB each):
  SHA-256: 6e0e86092f5e...

  📄 Downloads/backup/lecture_copy.pdf
  📄 Downloads/lecture.pdf
  📄 Downloads/lecture(1).pdf

  Wasted space: 240.0 KB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 2 (2 copies, 80.0 KB each):
  SHA-256: 2213df6534b2...

  📄 Downloads/image.png
  📄 Downloads/screenshots/image(1).png

  Wasted space: 80.0 KB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 3 (2 copies, 50.0 KB each):
  SHA-256: a2321272e8db...

  📄 Downloads/old/report_backup.docx
  📄 Downloads/report.docx

  Wasted space: 50.0 KB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 Total wasted space: 370.0 KB
```

---

### 3. `organize` — Sort & Copy Files into Category Folders

Copies files from a source directory into categorized folders inside the `--output` target directory (`Documents`, `Images`, `Archives`, `Code`, `Videos`, `Other`).

- **Category Mapping:**
  - `Documents`: `.pdf`, `.docx`, `.doc`, `.txt`, `.md`, `.xlsx`, `.pptx`
  - `Images`: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`
  - `Archives`: `.zip`, `.rar`, `.tar`, `.gz`, `.7z`
  - `Code`: `.js`, `.py`, `.java`, `.cpp`, `.html`, `.css`, `.json`
  - `Videos`: `.mp4`, `.avi`, `.mkv`, `.mov`, `.webm`
  - `Other`: Any unrecognized or missing extension
- **Copy Strategy:**
  - `< 10 MB`: `fs.copyFile(sourcePath, targetPath)`
  - `>= 10 MB`: `pipeline(fs.createReadStream(sourcePath), fs.createWriteStream(targetPath))`
- **Conflict Resolution:** Automatically renames colliding filenames in the destination folder (`notes.txt` ➔ `notes(1).txt`).

#### Syntax
```bash
node file-organizer.js organize <source_directory> --output <target_directory>
# or via npm:
npm run organize -- <source_directory> --output <target_directory>
```

#### Example Output
```text
📦 Organizing: /tmp/file-organizer-sandbox/Downloads
Target: /tmp/file-organizer-sandbox/Organized

Creating folders...
  ✓ Documents/
  ✓ Images/
  ✓ Archives/
  ✓ Code/
  ✓ Videos/
  ✓ Other/

Copying files... ████████████████████ 14/14

✅ Organization complete!

Summary:
  Documents:    8 files → Organized/Documents/
  Images:       2 files → Organized/Images/
  Archives:     1 files → Organized/Archives/
  Code:         1 files → Organized/Code/
  Videos:       1 files → Organized/Videos/
  Other:        1 files → Organized/Other/

Total copied: 14 files (12.4 MB)
```

---

### 4. `cleanup` — Remove Old Files (Dry Run & Confirmed Mode)

Identifies files whose last modification timestamp (`stats.mtime`) is older than `--older-than <days>`.

- **Without `--confirm` (Default Dry Run):** Lists all matching files, their sizes, and modification dates without deleting anything.
- **With `--confirm`:** Permanently deletes matching files via `fs.unlink()` and reports total disk space freed.

#### Syntax
```bash
# Preview files older than 90 days (Dry Run - safe default):
node file-organizer.js cleanup <directory> --older-than 90

# Permanently delete files older than 90 days:
node file-organizer.js cleanup <directory> --older-than 90 --confirm
```

#### Example Output (Dry Run Mode)
```text
🧹 Cleanup: /tmp/file-organizer-sandbox/Downloads
Looking for files older than 90 days...

Found 3 files to delete:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
old_report.pdf
  Size: 256.0 KB
  Modified: 365 days ago (2025-11-02)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
archive_backup.zip
  Size: 512.0 KB
  Modified: 180 days ago (2026-05-06)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
old/report_backup.docx
  Size: 50.0 KB
  Modified: 120 days ago (2026-07-05)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: 3 files (818.0 KB)

⚠️  DRY RUN MODE: No files were deleted.
To actually delete these files, run with --confirm flag.
```

#### Example Output (Confirmed Mode)
```text
🧹 Cleanup: /tmp/file-organizer-sandbox/Downloads
Looking for files older than 90 days...

Found 3 files to delete:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
archive_backup.zip
  Size: 512.0 KB
  Modified: 180 days ago (2026-05-06)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
old_report.pdf
  Size: 256.0 KB
  Modified: 365 days ago (2025-11-02)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
old/report_backup.docx
  Size: 50.0 KB
  Modified: 120 days ago (2026-07-05)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  DELETING 3 files (818.0 KB). This action cannot be undone!

Deleting... ████████████████████ 3/3

✅ Cleanup complete!
Deleted: 3 files (818.0 KB freed)
```

---

## ⚡ Event-Driven Architecture (`EventEmitter`)

Each domain module extends `EventEmitter` and emits structured lifecycle events consumed by `file-organizer.js`:

| Class (`lib/`) | Emitted Events | Payload Summary |
| :--- | :--- | :--- |
| **`Scanner`** (`lib/scanner.js`) | `scan-start`, `file-found`, `scan-complete` | Progress counters, file metadata, and aggregated statistics |
| **`DuplicateFinder`** (`lib/duplicates.js`) | `search-start`, `file-processed`, `duplicates-found` | File path, SHA-256 digest, duplicate groups, and wasted space |
| **`Organizer`** (`lib/organizer.js`) | `folder-created`, `copy-start`, `copy-complete`, `copy-error`, `organize-complete` | Category folder creation, copy method (`stream` vs `copyFile`), and summary |
| **`Cleanup`** (`lib/cleanup.js`) | `file-found`, `file-deleted`, `cleanup-complete` | Matching old files, deletion progress, and freed space summary |

---

## 🛡️ Error Handling

All CLI commands validate arguments and handle filesystem exceptions gracefully:

```bash
$ node file-organizer.js scan /non-existent-path
❌ Error: Directory or file not found: /non-existent-path
# Exits with code 1
```
