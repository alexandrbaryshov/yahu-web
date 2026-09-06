FROM node:20-alpine

WORKDIR /app

# У сервера нет внешних npm-зависимостей — используются только встроенные модули Node.js
COPY server.js ./
COPY xlsxReader.js ./
COPY lib ./lib
COPY public ./public

# Каталог для данных пользователя (db.json) — монтируется как volume в docker-compose.yml.
RUN mkdir -p /app/data
# Эталонная база блюд хранится ВНЕ volume, чтобы при пересборке образа новая
# версия базы всегда была доступна. Сервер при старте сам копирует её в
# /app/data/dishes.xlsx, если там ещё нет файла (первый запуск) — так данные,
# уже накопленные в volume (db.json), не теряются при обновлении образа.
COPY seed/dishes.xlsx /app/default-dishes.xlsx

EXPOSE 3000
ENV PORT=3000
ENV DATA_FILE=/app/data/db.json

CMD ["node", "server.js"]
