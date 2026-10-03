window.STATE =
{
  "version": 2,
  "slug": "fast-home",
  "dir": "2026-10-03-fast-home",
  "title": "Быстрая главная страница yahu-web",
  "mode": "semi",
  "depth": "normal",
  "tier": "T1",
  "briefFile": "2026-10-03-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "autopilot",
  "skillDir": "C:/Users/Александр/.claude/skills/autopilot",
  "baseCommit": "c84b1fa",
  "startedAt": "2026-10-03T21:46:35+03:00",
  "updatedAt": "2026-10-03T22:28:28+03:00",
  "finishedAt": "2026-10-03T22:28:28+03:00",
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
      "status": "done",
      "startedAt": "2026-10-03T21:56:51+03:00",
      "finishedAt": "2026-10-03T21:57:15+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-10-03T21:57:15+03:00",
      "finishedAt": "2026-10-03T22:13:42+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-10-03T22:13:42+03:00",
      "finishedAt": "2026-10-03T22:23:01+03:00"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-10-03T22:23:01+03:00",
      "finishedAt": "2026-10-03T22:28:28+03:00"
    }
  ],
  "requirements": {
    "total": 14,
    "done": 14,
    "inTicket": 0,
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
      "status": "done",
      "startedAt": "2026-10-03T21:57:16+03:00",
      "finishedAt": "2026-10-03T22:03:02+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 12,
        "failed": 0
      },
      "commit": "a4757d5"
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
      "status": "done",
      "startedAt": "2026-10-03T22:03:03+03:00",
      "finishedAt": "2026-10-03T22:13:41+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 26,
        "failed": 0
      },
      "commit": "be6fccb"
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
      "status": "done",
      "startedAt": "2026-10-03T21:57:16+03:00",
      "finishedAt": "2026-10-03T21:58:31+03:00",
      "retries": 0,
      "repairs": 0,
      "commit": "076ba04"
    },
    {
      "id": "F1",
      "title": "Правки по ревью ветки: заставка не зависает, свежие данные не затираются",
      "requirements": [
        "R08",
        "G03",
        "R07"
      ],
      "blockedBy": [],
      "wave": 3,
      "zone": [
        "public/index.html",
        "public/app.js",
        "public/startup.js",
        "test/startup.test.js"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-10-03T22:17:42+03:00",
      "finishedAt": "2026-10-03T22:22:48+03:00",
      "tests": {
        "passed": 31,
        "failed": 0
      },
      "commit": "56c1a1c"
    }
  ],
  "tests": {
    "passed": 31,
    "failed": 0
  },
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
  "concerns": [
    "server.js:130 — buildMacroTip получает Б/Ж/У, округлённые до 0,1, а не сырые суммы (было: сырые)",
    "test/server.test.js:11,79-80 — тест сверяет с sumTodayMulti/sumToday из lib/store, которые больше нигде не используются",
    "test/server.test.js:23 — seedState датирует записи «сейчас»: около 00:00 МСК тест может покраснеть",
    "server.js:182 — /api/health до ready отдаёт localRecordsCount по невосстановленному состоянию",
    "public/app.js — не проверены в браузере: таймаут 60 с при зависшем сервере, тап по заставке, visibilitychange, pull-to-refresh",
    "public/app.js:198-205 — если render() бросит после applyServerState, ошибка молча проглатывается",
    "public/app.js:1056 — saveReminders после успеха не перерисовывает всё, снимок обновится при следующем render()"
  ],
  "blind": {
    "checked": 7,
    "matched": 5,
    "mismatches": [
      "R07 — при медленном сервере с 6 по 15 с главная со старым снимком показывает устаревшие цифры (приглушены, «Обновляю…»), верные — только после ответа сервера",
      "G03 — второе устройство при спящем сервере видит чужие устаревшие цифры до ответа сервера; уже открытая вкладка подтягивает изменения только при возврате в неё спустя 60 с"
    ]
  },
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
    "2026-10-03T21:56:57+03:00",
    "2026-10-03T21:57:06+03:00",
    "2026-10-03T21:57:15+03:00",
    "2026-10-03T21:57:16+03:00",
    "2026-10-03T21:58:31+03:00",
    "2026-10-03T22:01:44+03:00",
    "2026-10-03T22:03:02+03:00",
    "2026-10-03T22:03:03+03:00",
    "2026-10-03T22:13:41+03:00",
    "2026-10-03T22:13:42+03:00",
    "2026-10-03T22:17:40+03:00",
    "2026-10-03T22:17:41+03:00",
    "2026-10-03T22:17:42+03:00",
    "2026-10-03T22:21:19+03:00",
    "2026-10-03T22:22:48+03:00",
    "2026-10-03T22:23:01+03:00",
    "2026-10-03T22:27:30+03:00",
    "2026-10-03T22:28:28+03:00"
  ],
  "report": [
    "Фото профиля: если фото удалили на другом устройстве, до ответа сервера на этом устройстве аватар — пустой кружок",
    "Проверка /api/health до восстановления данных показывает число записей из локального файла (только диагностика, рядом ready:false)",
    "Тест сервера может редко покраснеть, если его запустить ровно около 00:00 МСК"
  ]
}
