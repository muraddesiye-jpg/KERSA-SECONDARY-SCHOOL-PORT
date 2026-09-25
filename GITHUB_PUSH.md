# Push Kersa Portal to GitHub

1. Create a new empty GitHub repository.
2. Open this project folder in VS Code.
3. Open Terminal.
4. Run:

```bash
git init
git add .
git commit -m "Build Kersa Secondary School portal"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Never commit `.env`, `data/kersa.sqlite`, private uploads, passwords, or real student records.

Before pushing, verify:

```bash
git status
```

`.gitignore` is already configured to exclude the sensitive/runtime files.
