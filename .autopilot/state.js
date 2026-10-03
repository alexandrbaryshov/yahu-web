window.STATE =
{
  "version": 2,
  "slug": "fast-home",
  "dir": "2026-10-03-fast-home--wip",
  "title": "Быстрая главная страница yahu-web",
  "mode": "semi",
  "depth": "normal",
  "tier": "T1",
  "briefFile": "2026-10-03-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "autopilot",
  "skillDir": "C:/Users/Александр/.claude/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-10-03T21:46:35+03:00",
  "updatedAt": "2026-10-03T21:56:57+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-10-03T21:46:35+03:00",
      "finishedAt": "2026-10-03T21:46:49+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-10-03T21:46:49+03:00",
      "finishedAt": "2026-10-03T21:47:09+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-10-03T21:47:09+03:00",
      "finishedAt": "2026-10-03T21:53:08+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-10-03T21:53:08+03:00",
      "finishedAt": "2026-10-03T21:56:51+03:00"
    },
    {
      "id": "plan",
      "status": "active",
      "startedAt": "2026-10-03T21:56:51+03:00"
    },
    {
      "id": "build",
      "status": "pending"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 14,
    "done": 0,
    "inTicket": 14,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Общий расчёт «сегодня», лёгкий ответ сервера, быстрый старт",
      "requirements": [
        "R05",
        "R10",
        "R02",
        "R01",
        "R11i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "server.js",
        "lib/",
        "public/today.js",
        "test/"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Заставка со слоганом и мгновенная актуальная главная",
      "requirements": [
        "R04",
        "R06",
        "R07",
        "R08",
        "R09",
        "R10",
        "G01",
        "G03",
        "R05",
        "R11i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "public/index.html",
        "public/app.js",
        "public/sw.js"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "03",
      "title": "Пошаговая инструкция: надёжный пингер, чтобы Render не засыпал",
      "requirements": [
        "R03",
        "G02",
        "R02"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "docs/",
        "README.md",
        ".github/workflows/keep-alive.yml"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    }
  ],
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 2,
    "fixed": 2,
    "deferred": 0,
    "items": []
  },
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-10-03T21:46:35+03:00",
    "2026-10-03T21:46:49+03:00",
    "2026-10-03T21:47:08+03:00",
    "2026-10-03T21:47:09+03:00",
    "2026-10-03T21:53:08+03:00",
    "2026-10-03T21:56:13+03:00",
    "2026-10-03T21:56:51+03:00",
    "2026-10-03T21:56:52+03:00",
    "2026-10-03T21:56:56+03:00",
    "2026-10-03T21:56:57+03:00"
  ]
}
