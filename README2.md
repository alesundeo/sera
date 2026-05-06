# 🎮 МОЙТОХОНОВ ФЕДОР — Multiplayer

Сетевой тактический шутер в стиле CS2. До 6 игроков в комнате.

## Управление
| Кнопка | Действие |
|--------|----------|
| WASD | Движение |
| Мышь | Прицел |
| ЛКМ | Стрельба |
| R | Перезарядка |
| TAB | Таблица счёта |

---

## 🚀 Деплой на Railway (рекомендуется, бесплатно)

1. Зайди на [railway.app](https://railway.app) → Sign up with GitHub
2. Нажми **"New Project"** → **"Deploy from GitHub repo"**
3. Залей папку `moytohonov-fedor` в GitHub репозиторий
4. Railway автоматически найдёт `package.json` и запустит `npm start`
5. Нажми **"Generate Domain"** — получишь ссылку вида `https://xxx.railway.app`
6. Отправь ссылку другу — он заходит и вводит код комнаты

---

## 🚀 Деплой на Render (бесплатно)

1. Залей в GitHub репо
2. Зайди на [render.com](https://render.com) → **New Web Service**
3. Выбери репо, укажи:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Нажми Deploy — через 2-3 минуты получишь URL

---

## 🚀 Деплой на Glitch (самый простой)

1. Зайди на [glitch.com](https://glitch.com) → **New Project** → **Import from GitHub**
2. Или создай новый проект и скопируй файлы вручную:
   - `server.js`
   - `package.json`
   - `public/index.html`
3. Glitch автоматически запустит — получишь URL вида `https://xxx.glitch.me`

---

## Локальный запуск (для теста)

```bash
cd moytohonov-fedor
npm install
npm start
# Открой http://localhost:3000
```

## Структура

```
moytohonov-fedor/
├── server.js          # Node.js + WebSocket сервер
├── package.json
└── public/
    └── index.html     # Клиент игры
```

