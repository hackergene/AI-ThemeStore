# Theme format

Each theme lives in its own directory under:

```text
~/Library/Application Support/AIThemeStore/themes/<theme-id>/
```

The directory name must match the `id` in `theme.json`. IDs may contain ASCII
letters, numbers, `.`, `_`, and `-`, up to 80 characters. Referenced assets
must be regular files inside the same directory; absolute paths, parent paths,
subdirectories, and symbolic links are rejected.

Minimal example:

```json
{
  "schemaVersion": 2,
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "author": "Your name",
  "description": "A quiet local theme.",
  "assets": {
    "hero": "hero.png",
    "taskBackground": "hero.png"
  },
  "appearance": {
    "preferredMode": "dark",
    "colors": {
      "background": "#12141A",
      "panel": "#1B1F29",
      "accent": "#8BA7FF",
      "text": "#F5F7FF",
      "muted": "#A8B0C4"
    }
  },
  "layout": {
    "backgroundMode": "full",
    "heroPosition": "70% center",
    "taskPosition": "74% center"
  },
  "effects": {
    "blur": 14,
    "panelOpacity": 0.72,
    "sidebarOpacity": 0.5,
    "motion": "none"
  }
}
```

Use an ultra-wide image with quiet space on the left so native controls remain
readable. Test every contribution on New Chat and an active task route.
