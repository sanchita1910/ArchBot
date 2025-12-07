FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* /app/
RUN npm install --production || npm install --production

COPY . /app

ENV PORT=3001
ENV OLLAMA_HOST=http://ollama:11434
ENV OLLAMA_MODEL=llama3.2

EXPOSE 3001

CMD ["npm", "start"]
