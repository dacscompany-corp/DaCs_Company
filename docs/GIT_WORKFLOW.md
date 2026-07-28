# Git Workflow Guide

## Before Starting Work
Always pull first to sync with GitHub:
```bash
git pull origin main
```

## After Making Changes
```bash
git add .
git commit -m "your message here"
git push origin main
```

## Full Example
```bash
git pull origin main
git add .
git commit -m "Fix invoice permission and update billing page"
git push origin main
```

## Rules
- Always `git pull` before you start working
- Always `git add .` — safe because `.gitignore` excludes `node_modules/`, `build/`, and `sw.js`
- Push frequently to avoid conflicts

